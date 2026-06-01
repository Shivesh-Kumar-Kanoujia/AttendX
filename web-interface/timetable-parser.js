import { escHtml, escAttr, showToast } from "./utils.js";
import { currentUser } from "./auth.js";

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_RANGE_RE = /\b(\d{1,2})[:.](\d{2})\s*[-–—to]+\s*(\d{1,2})[:.](\d{2})\b/i;
const TIME_SINGLE_RE = /\b(\d{1,2})[:.](\d{2})\b/;

let _onParsed = null;

export function initParser(onParsed) {
  _onParsed = onParsed;
}

let _pdfjs = null;
async function getPdfJs() {
  if (!_pdfjs) {
    const urls = [
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs",
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs",
    ];
    let lastErr;
    for (const url of urls) {
      try {
        _pdfjs = await import(url);
        _pdfjs.GlobalWorkerOptions.workerSrc = url.replace("pdf.min.mjs", "pdf.worker.min.mjs");
        break;
      } catch (e) { lastErr = e; }
    }
    if (!_pdfjs) throw lastErr || new Error("Failed to load pdf.js");
  }
  return _pdfjs;
}

export async function parseTimetable(fileData, fileType, file) {
  if (fileType === "pdf" && (file || fileData)) {
    await parsePdf(file, fileData);
  } else if (fileType === "image" && fileData) {
    await parseImage(fileData);
  } else {
    showEditor([]);
  }
}

/**
 * Try to detect timetable grid from an image using client-side heuristic.
 * Falls through to manual editor if detection fails.
 */
async function parseImage(fileData) {
  try {
    const { detectGridFromImage } = await import("./image-grid-detector.js");
    const classes = await detectGridFromImage(fileData);

    if (classes.length > 0) {
      showEditor(classes, "Auto-detected " + classes.length + " classes from image. Please review and correct.");
    } else {
      showEditor([], "Could not auto-detect timetable structure from this image. Please enter manually.");
    }
  } catch (e) {
    console.warn("[AttendX] Image grid detection failed:", e);
    showEditor([], "Could not process this image. Please enter manually.");
  }
}

// ── Main PDF pipeline ──
async function parsePdf(file, fileData) {
  showToast("Parsing timetable…");
  let rawText = "";
  let classes = [];

  // Strategy 1: Backend API (pdfplumber) — uses raw file
  // Only try backend if user is logged in (requires auth token)
  if (currentUser) {
    try {
      const { apiExtractPdf } = await import("./api.js");
      const result = await apiExtractPdf(file);
      if (result.tables?.length) {
        classes = parseBackendTables(result.tables);
        rawText = result.text || "";
        if (classes.length || rawText) {
          showEditor(classes, rawText); return;
        }
      }
      if (result.text) rawText = result.text;
    } catch (e) {
      console.warn("[AttendX] Backend unavailable (guest mode or offline):", e);
    }
  } else {
    // guest mode — will use client-side PDF parsing
  }

  // Use the original file's ArrayBuffer directly (avoids large base64 decode)
  let pdfBuffer;
  try {
    pdfBuffer = await file.arrayBuffer();
  } catch (e) {
    console.error("[AttendX] Could not read file:", e);
    showToast("Could not read file. Please try again.");
    showEditor([]);
    return;
  }

  // Strategy 2: Client-side layout parsing
  try {
    const pdfjs = await getPdfJs();
    const pdf = await pdfjs.getDocument({ data: pdfBuffer }).promise;
    const pages = await extractPdfLayout(pdf);
    rawText = pages.map(p => p.lines.map(l => l.items.map(i => i.text).join(" ")).join("\n")).join("\n");

    if (pages.length) {
      classes = detectAndParseTable(pages[0].lines);
      if (classes.length) { showEditor(classes, rawText); return; }
      const textLines = pages[0].lines.map(l => l.items.map(i => i.text).join(" "));
      classes = guessClassesFromText(textLines);
      if (classes.length) { showEditor(classes, rawText); return; }
    }
  } catch (e) { console.error("[AttendX] Layout parse error:", e); }

  // Strategy 3: Simple text fallback (same pdfBuffer)
  try {
    const pdfjs = await getPdfJs();
    const pdf = await pdfjs.getDocument({ data: pdfBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(" ") + "\n";
    }
    rawText = text;
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    classes = guessClassesFromText(lines);
    showEditor(classes, rawText);
  } catch (e) {
    console.error("[AttendX] PDF extraction error:", e);
    showToast("Could not extract text from this PDF. Please enter manually.");
    showEditor([], rawText || "");
  }
}

// ── Layout-aware extraction from parsed PDF document ─────────────
async function extractPdfLayout(pdf) {
  const pages = [];
  const Y_TOLERANCE = 5;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const pageHeight = viewport.height;

    const items = content.items.map(item => ({
      text: item.str,
      x: item.transform[4],
      y: pageHeight - item.transform[5],
      width: item.width || 0,
      height: item.height || 0,
    })).sort((a, b) => a.y - b.y || a.x - b.x);

    const lines = [];
    let current = null;
    for (const item of items) {
      if (!current || Math.abs(item.y - current.y) > Y_TOLERANCE) {
        current = { y: item.y, items: [] };
        lines.push(current);
      }
      current.items.push(item);
    }

    for (const line of lines) line.items.sort((a, b) => a.x - b.x);
    pages.push({ lines, width: viewport.width, height: pageHeight });
  }

  return pages;
}

// ── Detect and parse a table layout (grid timetable) ──────────────
function detectAndParseTable(lines) {
  if (lines.length < 3) return [];

  // Step 1: find the header row with day abbreviations
  let headerIdx = -1;
  let dayColMap = {}; // dayIndex -> headerItemIndex

  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const items = lines[i].items;
    const found = {};
    for (let j = 0; j < items.length; j++) {
      const t = items[j].text.trim();
      const lower = t.toLowerCase();
      for (let d = 0; d <= 6; d++) {
        const short = DAYS_SHORT[d].toLowerCase();
        if (lower === short || lower.startsWith(short)) { found[d] = j; break; }
        if (t.length <= 2 && t.toUpperCase() === DAYS_SHORT[d][0] && DAYS_SHORT[d][0] !== "T" && DAYS_SHORT[d][0] !== "S") {
          found[d] = j; break;
        }
      }
    }
    // Disambiguate T/S with multi-char matches
    for (let j = 0; j < items.length; j++) {
      const t = items[j].text.trim().toLowerCase();
      if (t === "t" || t === "tu" || t === "tue") { found[2] = j; }
      if (t === "th" || t === "thu" || t === "thur") { found[3] = j; }
      if (t === "s" || t === "sa" || t === "sat") { found[6] = j; }
      if (t === "su" || t === "sun") { found[0] = j; }
    }
    if (Object.keys(found).length >= 3) {
      headerIdx = i;
      dayColMap = found;
      break;
    }
  }

  if (headerIdx === -1) return [];
  const headerItems = lines[headerIdx].items;

  // Step 2: compute column centers from header items
  // Map header item index → x-center
  const headerCenters = headerItems.map((item, idx) => ({
    idx,
    center: item.x + item.width / 2,
    start: item.x,
    end: item.x + item.width,
  }));

  // Step 3: Compute column boundaries from midpoints between header items
  const colBoundaries = headerCenters.map((h, i) => {
    const prevEnd = i > 0 ? (headerCenters[i - 1].end + h.start) / 2 : 0;
    const nextStart = i < headerCenters.length - 1
      ? (h.end + headerCenters[i + 1].start) / 2
      : Infinity;
    return { center: h.center, start: prevEnd, end: nextStart };
  });

  // Step 4: find time rows below header (any item matches time pattern)
  const timeRows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const hasTime = lines[i].items.some(item => TIME_RANGE_RE.test(item.text));
    if (hasTime) timeRows.push(i);
  }
  if (timeRows.length === 0) return [];

  // Step 5: parse the grid
  const classes = [];
  const seen = new Set();

  for (const ri of timeRows) {
    const row = lines[ri];
    const timeItem = row.items.find(item => TIME_RANGE_RE.test(item.text));
    if (!timeItem) continue;
    const tm = timeItem.text.match(TIME_RANGE_RE);
    if (!tm) continue;
    const startTime = `${tm[1].padStart(2, "0")}:${tm[2]}`;
    const endTime = `${tm[3].padStart(2, "0")}:${tm[4]}`;

    // Collect items from this + continuation lines (non-time rows immediately after)
    const allRowItems = [...row.items];
    for (let k = ri + 1; k < Math.min(ri + 4, lines.length); k++) {
      const nr = lines[k];
      if (nr.y - row.y > 60) break;
      if (nr.items.some(item => TIME_RANGE_RE.test(item.text))) break;
      allRowItems.push(...nr.items);
    }

    for (const [dayIdx, colHeaderIdx] of Object.entries(dayColMap)) {
      const bounds = colBoundaries[colHeaderIdx];
      if (!bounds) continue;

      // Find items whose x-center falls within this column's boundaries
      const cellTexts = [];
      for (const item of allRowItems) {
        if (item === timeItem) continue;
        const cx = item.x + item.width / 2;
        if (cx >= bounds.start && cx < bounds.end) {
          cellTexts.push(item.text.trim());
        }
      }

      const cellText = cellTexts.filter(Boolean).join(" ");
      if (!cellText || /^[-–—×]+$/.test(cellText)) continue;

      const key = `${dayIdx}_${startTime}_${endTime}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const parsed = parseCellText(cellText);
      classes.push({
        id: `cls_${Date.now()}_${classes.length}`,
        name: parsed.name,
        shortCode: parsed.shortCode,
        color: "#6366F1",
        dayOfWeek: [parseInt(dayIdx)],
        startTime,
        endTime,
        room: parsed.room,
        teacher: parsed.teacher,
        notes: "",
      });
    }
  }

  return classes;
}

// ── Parse a single cell text into subject/room/teacher ────────────
function parseCellText(text) {
  let name = text, shortCode = "", room = "", teacher = "";

  // Try to extract subject code like CS101, MTH101, PHY101, etc.
  const codeMatch = text.match(/\b([A-Za-z]{2,4}\s*\d{3,4})\b/);
  if (codeMatch) {
    shortCode = codeMatch[1].replace(/\s+/g, "");
    name = text;
  }

  // Try to extract room like A-101, B-201, LH-1, etc.
  const roomMatch = text.match(/\b([A-Za-z]+[-–]\s*\d+[A-Za-z]?\b)/);
  if (roomMatch) {
    room = roomMatch[1].replace(/\s*[-–]\s*/, "-");
    name = name.replace(roomMatch[0], "").trim();
  }

  // Try to extract teacher name (after room or standalone)
  if (room) {
    const afterRoom = text.substring(text.indexOf(roomMatch[0]) + roomMatch[0].length).trim();
    if (afterRoom) teacher = afterRoom;
  }

  // Clean up name: remove code, room, teacher
  if (shortCode) {
    name = name.replace(new RegExp(shortCode.replace(/\s+/g, "\\s*"), "i"), "").trim();
  }
  if (room) {
    name = name.replace(new RegExp(room.replace(/[-–]/g, "[-–]"), "i"), "").trim();
  }
  if (teacher) {
    name = name.replace(teacher, "").trim();
  }
  name = name.replace(/^[-–—,;\s]+|[-–—,;\s]+$/g, "");

  // If name is empty after cleanup, use shortCode as name
  if (!name && shortCode) name = shortCode;

  return { name: name || text, shortCode, room, teacher };
}

// ── Parse backend table data from pdfplumber ──────────────────────
function parseBackendTables(tables) {
  const classes = [];
  const seen = new Set();

  for (const table of tables) {
    if (!table.rows || table.rows.length < 2) continue;
    const rows = table.rows;

    // Find header row (first row with day names)
    let headerRow = null;
    let dayColumns = {};
    for (let r = 0; r < Math.min(rows.length, 3); r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const cell = (row[c] || "").trim();
        const lower = cell.toLowerCase();
        for (let d = 0; d <= 6; d++) {
          if (lower === DAYS_SHORT[d].toLowerCase()) {
            dayColumns[c] = d;
            break;
          }
        }
      }
      if (Object.keys(dayColumns).length >= 3) {
        headerRow = r;
        break;
      }
    }
    if (headerRow === null) continue;

    // Find time column (first column with time ranges)
    let timeCol = -1;
    for (let r = headerRow + 1; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const cell = (rows[r][c] || "").trim();
        if (TIME_RANGE_RE.test(cell)) { timeCol = c; break; }
      }
      if (timeCol >= 0) break;
    }
    if (timeCol < 0) continue;

    // Parse data rows
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      const timeCell = (row[timeCol] || "").trim();
      const tm = timeCell.match(TIME_RANGE_RE);
      if (!tm) continue;
      const startTime = `${tm[1].padStart(2, "0")}:${tm[2]}`;
      const endTime = `${tm[3].padStart(2, "0")}:${tm[4]}`;

      for (const [colIdx, dayIdx] of Object.entries(dayColumns)) {
        const cellText = (row[parseInt(colIdx)] || "").trim();
        if (!cellText || /^[-–—]+$/.test(cellText)) continue;

        const key = `${dayIdx}_${startTime}_${endTime}`;
        if (seen.has(key)) continue;

        const parsed = parseCellText(cellText);
        classes.push({
          id: `cls_${Date.now()}_${classes.length}`,
          name: parsed.name,
          shortCode: parsed.shortCode,
          color: "#6366F1",
          dayOfWeek: [parseInt(dayIdx)],
          startTime,
          endTime,
          room: parsed.room,
          teacher: parsed.teacher,
          notes: "",
        });
        seen.add(key);
      }
    }
  }
  return classes;
}

// ── Improved heuristic (for non-table layouts) ────────────────────
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_ABBRS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function parseTimeEntry(trimmed, currentDay) {
  const lower = trimmed.toLowerCase();

  // Check if line is a day header
  for (let d = 0; d < DAY_NAMES.length; d++) {
    if (lower === DAY_NAMES[d] || lower === DAY_ABBRS[d] || lower.startsWith(DAY_NAMES[d] + ":")) {
      return { isDayHeader: true, day: d };
    }
  }

  // Try time RANGE first (HH:MM - HH:MM)
  let tm = trimmed.match(TIME_RANGE_RE);
  let isSingleTime = false;
  if (!tm) {
    // Fallback: single time (HH:MM) — assume 1-hour duration
    tm = trimmed.match(TIME_SINGLE_RE);
    if (!tm) return null;
    isSingleTime = true;
  }

  const startTime = `${tm[1].padStart(2, "0")}:${tm[2]}`;
  let endTime;
  if (isSingleTime) {
    // Derive end time as 1 hour after start
    const [h, m] = startTime.split(":").map(Number);
    endTime = `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  } else {
    endTime = `${tm[3].padStart(2, "0")}:${tm[4]}`;
  }

  const matchLen = tm[0].length;
  const matchIdx = tm.index;
  const afterTime = trimmed.slice(matchIdx + matchLen).trim();
  const beforeTime = trimmed.slice(0, matchIdx).trim();
  const fullText = (beforeTime + " " + afterTime).trim();
  if (!fullText) return null;

  // Try to extract day from before-time text (e.g. "Mon 09:00-10:00 MTH101")
  let classDays;
  let dayInBefore = false;
  if (currentDay >= 0) {
    classDays = [currentDay];
  } else if (beforeTime) {
    const btLower = beforeTime.toLowerCase();
    classDays = [];
    for (let d = 0; d < DAY_NAMES.length; d++) {
      if (btLower === DAY_NAMES[d] || btLower === DAY_ABBRS[d] || btLower.startsWith(DAY_NAMES[d])) {
        classDays.push(d);
        dayInBefore = true;
        break;
      }
    }
    if (classDays.length === 0) classDays = [1, 2, 3, 4, 5];
  } else {
    classDays = [1, 2, 3, 4, 5];
  }

  const cellText = dayInBefore
    ? fullText.replace(new RegExp("^" + DAY_NAMES[classDays[0]] + "|^" + DAY_ABBRS[classDays[0]], "i"), "").trim()
    : fullText;

  return { classDays, cellText, startTime, endTime };
}

function guessClassesFromText(lines) {
  const classes = [];
  let currentDay = -1;
  let seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const entry = parseTimeEntry(trimmed, currentDay);
    if (!entry) continue;
    if (entry.isDayHeader) { currentDay = entry.day; continue; }

    const key = `${entry.classDays[0]}_${entry.startTime}_${entry.cellText}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const parsed = parseCellText(entry.cellText);
    classes.push({
      id: `cls_${Date.now()}_${classes.length}`,
      name: parsed.name,
      shortCode: parsed.shortCode,
      color: "#6366F1",
      dayOfWeek: entry.classDays,
      startTime: entry.startTime,
      endTime: entry.endTime,
      room: parsed.room,
      teacher: parsed.teacher,
      notes: "",
    });
  }

  return classes;
}

// ── Editor modal (day-wise) ──────────────────────────────────────
function showEditor(classes, extractedText) {
  const existing = document.getElementById("timetable-parse-modal");
  if (existing) existing.remove();

  const byDay = [[], [], [], [], [], [], []];
  if (classes && classes.length) {
    classes.forEach(cls => {
      const days = Array.isArray(cls.dayOfWeek) ? cls.dayOfWeek : [cls.dayOfWeek];
      days.forEach(day => { byDay[day].push(cls); });
    });
  }

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayBorderColors = [
    "border-l-red-400", "border-l-blue-400", "border-l-emerald-400",
    "border-l-amber-400", "border-l-purple-400", "border-l-pink-400", "border-l-gray-400"
  ];

   const totalClasses = classes ? classes.length : 0;
   const today = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
   let sectionsHtml = "";
   for (let d = 0; d < 7; d++) {
     const dayClasses = byDay[d];
     let rowsHtml = "";
     if (dayClasses.length === 0) {
       if (totalClasses === 0 && d === today) {
         rowsHtml = dayRowHtml({ id: `cls_${Date.now()}_${d}_0`, name: "", shortCode: "", color: "#6366F1", startTime: "09:00", endTime: "10:00", room: "", teacher: "" }, d, today + 1);
       }
     } else {
      dayClasses.forEach((cls, i) => { rowsHtml += dayRowHtml(cls, d, i + 1); });
    }
    sectionsHtml += `
      <div class="mb-4">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-1 h-5 rounded-full ${dayBorderColors[d]}"></span>
          <h3 class="font-semibold text-sm text-ink">${dayNames[d]}</h3>
          <button type="button" class="btn-add-day-row ml-auto text-xs text-accent font-medium hover:underline" data-day="${d}">+ Add class</button>
        </div>
        <div class="overflow-x-auto rounded-xl border border-gray-200">
          <table class="w-full border-collapse" data-day="${d}">
            <thead>
              <tr class="bg-soft/60 text-left text-xs text-muted uppercase tracking-wider font-semibold">
                <th class="p-2 w-8 text-center">#</th>
                <th class="p-2 min-w-[120px]">Subject</th>
                <th class="p-2 w-[55px]">Code</th>
                <th class="p-2 w-[75px]">Start</th>
                <th class="p-2 w-[75px]">End</th>
                <th class="p-2 w-[70px]">Room</th>
                <th class="p-2 w-[90px]">Teacher</th>
                <th class="p-2 min-w-[120px]">Notes</th>
                <th class="p-2 w-[44px]">Colour</th>
                <th class="p-2 w-8"></th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  const modal = document.createElement("div");
  modal.id = "timetable-parse-modal";
  modal.className = "fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm pt-4 pb-8 overflow-y-auto";
  modal.innerHTML = `
    <div class="glass-card rounded-3xl p-5 w-full max-w-5xl mx-4">
      <div class="flex justify-between items-center mb-4">
        <div>
          <h2 class="text-xl font-bold text-ink">Edit Timetable</h2>
          <p class="text-muted text-sm mt-1">Add classes day-wise — enter all lectures for each day separately</p>
        </div>
        <button id="parse-modal-close" class="w-8 h-8 rounded-xl hover:bg-soft/80 flex items-center justify-center text-muted">✕</button>
      </div>

      ${classes.length === 0 && extractedText ? `
        <div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          Could not auto-detect classes from the extracted text. You can add them manually below.
        </div>
      ` : ""}
      ${extractedText ? `
        <details class="mb-4" ${classes.length === 0 ? "open" : ""}>
          <summary class="text-xs text-muted cursor-pointer hover:text-ink font-medium">Raw extracted text (${extractedText.split("\n").length} lines)</summary>
          <pre class="mt-2 p-3 bg-gray-50 rounded-xl text-xs text-muted max-h-32 overflow-y-auto">${escHtml(extractedText)}</pre>
        </details>
      ` : ""}

      <div class="day-wise-sections">
        ${sectionsHtml}
      </div>

      <div class="flex gap-3 mt-5 pt-4 border-t border-gray-200">
        <button id="btn-cancel-parse" class="flex-1 py-3 rounded-xl border border-gray-300 text-ink font-medium hover:bg-soft/50 transition-colors">Cancel</button>
        <button id="btn-save-parse" class="flex-1 btn-primary py-3 rounded-xl text-sm font-semibold">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelectorAll(".btn-add-day-row").forEach(btn => {
    btn.addEventListener("click", () => {
      const day = parseInt(btn.dataset.day);
      const tbody = modal.querySelector(`table[data-day="${day}"] tbody`);
      const rowNum = tbody.children.length + 1;
      tbody.insertAdjacentHTML("beforeend", dayRowHtml({
        id: `cls_${Date.now()}_${day}_${rowNum}`,
        name: "", shortCode: "", color: "#6366F1",
        startTime: "09:00", endTime: "10:00",
        room: "", teacher: "",
      }, day, rowNum));
      wireDeleteButtons(tbody);
    });
  });

  wireDeleteButtons(modal);

  modal.querySelector("#parse-modal-close").onclick = () => modal.remove();
  modal.querySelector("#btn-cancel-parse").onclick = () => modal.remove();

  modal.querySelector("#btn-save-parse").onclick = () => {
    try {
      const saved = [];
      modal.querySelectorAll("table[data-day]").forEach(table => {
        const day = parseInt(table.dataset.day);
        table.querySelectorAll("tbody tr").forEach(row => {
          const name = row.querySelector(".field-name")?.value?.trim();
          if (!name) return;
          saved.push({
            id: `cls_${Date.now()}_${saved.length}`,
            name,
            shortCode: row.querySelector(".field-short")?.value?.trim() || name.slice(0, 3).toUpperCase(),
            color: row.querySelector(".field-color")?.value || "#6366F1",
            dayOfWeek: [day],
            startTime: row.querySelector(".field-start")?.value || "09:00",
            endTime: row.querySelector(".field-end")?.value || "10:00",
            room: row.querySelector(".field-room")?.value?.trim() || "",
            teacher: row.querySelector(".field-teacher")?.value?.trim() || "",
            notes: row.querySelector(".field-notes")?.value?.trim() || "",
          });
        });
      });

      if (saved.length === 0) {
        showToast("Add at least one subject name to save.");
        return;
      }

      modal.remove();
      if (_onParsed) _onParsed(saved);
    } catch (err) {
      console.error("[AttendX] Save error:", err);
      showToast("Save failed. Check console for details.");
    }
  };

  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

function dayRowHtml(cls, dayIdx, rowNum) {
  return `
    <tr class="border-b border-gray-100 hover:bg-soft/30 transition-colors" data-cls-id="${escAttr(cls.id)}">
      <td class="p-2 text-center"><span class="row-num text-muted text-xs">${rowNum}</span></td>
      <td class="p-2"><input type="text" class="field-name w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:border-accent focus:outline-none bg-transparent" value="${escAttr(cls.name)}" placeholder="Subject" /></td>
      <td class="p-2"><input type="text" class="field-short w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:border-accent focus:outline-none bg-transparent" value="${escAttr(cls.shortCode)}" placeholder="MTH" maxlength="5" /></td>
      <td class="p-2"><input type="time" class="field-start w-full px-1 py-1.5 text-sm rounded-lg border border-gray-200 focus:border-accent focus:outline-none bg-transparent" value="${cls.startTime}" /></td>
      <td class="p-2"><input type="time" class="field-end w-full px-1 py-1.5 text-sm rounded-lg border border-gray-200 focus:border-accent focus:outline-none bg-transparent" value="${cls.endTime}" /></td>
      <td class="p-2"><input type="text" class="field-room w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:border-accent focus:outline-none bg-transparent" value="${escAttr(cls.room)}" placeholder="A-101" /></td>
      <td class="p-2"><input type="text" class="field-teacher w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:border-accent focus:outline-none bg-transparent" value="${escAttr(cls.teacher)}" placeholder="Dr. ..." /></td>
      <td class="p-2"><input type="text" class="field-notes w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 focus:border-accent focus:outline-none bg-transparent" value="${escAttr(cls.notes || "")}" placeholder="Homework..." /></td>
      <td class="p-2"><input type="color" class="field-color w-full h-8 rounded-lg border-0 cursor-pointer p-0" value="${cls.color}" /></td>
      <td class="p-2"><button class="btn-del-row w-7 h-7 rounded-lg hover:bg-red-50 text-muted hover:text-red-500 transition-colors text-lg leading-none">&times;</button></td>
    </tr>
  `;
}

function wireDeleteButtons(container) {
  container.querySelectorAll(".btn-del-row").forEach(btn => {
    btn.addEventListener("click", () => {
      const tr = btn.closest("tr");
      const tbody = tr.parentElement;
      tr.remove();
      tbody.querySelectorAll("tr").forEach((tr, i) => {
        const num = tr.querySelector(".row-num");
        if (num) num.textContent = i + 1;
      });
    });
  });
}

export function showManualEntryModal(existingClasses) {
  showEditor(existingClasses || []);
}


