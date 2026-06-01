/**
 * AttendX — timetable-view.js
 * Daily timeline view of today's classes.
 * Exposes: renderTodayView(classes, logs, containerEl), renderFullTimetableView(classes, containerEl)
 */

import { getClassStatus } from "./timetable-engine.js";
import { escHtml, todayYMD } from "./utils.js";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function safeColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#6366F1";
}

export function renderTodayView(classes, logs, containerEl) {
  const today = new Date();
  const dayName = DAY_NAMES[today.getDay()];
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  if (!classes || classes.length === 0) {
    containerEl.innerHTML = `
      <div class="text-center py-12">
        <div class="text-5xl mb-4">📅</div>
        <h3 class="text-ink font-bold text-lg mb-2">No classes today</h3>
        <p class="text-muted text-sm mb-6">Upload your timetable to see your schedule here</p>
        <button onclick="window.showUploadModal()" class="btn-primary px-6 py-3 rounded-xl text-sm font-semibold">
          Upload Timetable
        </button>
      </div>
    `;
    return;
  }

  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentMinOfDay = currentHour * 60 + currentMin;

  // Time range for timeline
  const firstStart = classes.reduce((min, c) => {
    const [h, m] = c.startTime.split(":").map(Number);
    return Math.min(min, h * 60 + m);
  }, 24 * 60);
  const lastEnd = classes.reduce((max, c) => {
    const [h, m] = c.endTime.split(":").map(Number);
    return Math.max(max, h * 60 + m);
  }, 0);

  const timelineStart = Math.floor((firstStart - 60) / 30) * 30;
  const timelineEnd = Math.ceil((lastEnd + 60) / 30) * 30;

  containerEl.innerHTML = `
    <div class="mb-4 flex items-center justify-between">
      <div>
        <h2 class="text-ink font-bold text-lg">${dayName}</h2>
        <p class="text-muted text-sm">${dateStr} · ${classes.length} class${classes.length !== 1 ? "es" : ""}</p>
      </div>
      <div class="flex gap-2">
        <button onclick="window.openFullTimetable()" class="text-sm text-accent font-medium hover:underline">Full Timetable</button>
        <span class="text-muted text-xs">·</span>
        <button onclick="window.showManualEntryModal()" class="text-sm text-accent font-medium hover:underline">Edit</button>
      </div>
    </div>

    <div class="relative" id="timeline-container" style="min-height: ${((timelineEnd - timelineStart) / 30) * 48}px">
      <!-- Time labels -->
      <div class="absolute left-0 top-0 w-12 text-muted text-xs text-right pr-2">
        ${Array.from({ length: Math.floor((timelineEnd - timelineStart) / 30) + 1 }, (_, i) => {
          const mins = timelineStart + i * 30;
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          const label = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
          return `<div class="h-12 flex items-start pt-1" style="margin-top:${i === 0 ? 0 : -12}px">${label}</div>`;
        }).join("")}
      </div>

      <!-- Current time indicator -->
      <div class="absolute left-14 right-0 border-t-2 border-red-400 z-10" id="now-indicator" style="top:${((currentMinOfDay - timelineStart) / 30) * 48}px">
        <div class="absolute -left-14 top-0 transform -translate-y-1/2 text-red-500 text-xs font-bold">NOW</div>
      </div>

      <!-- Class cards -->
      <div class="absolute left-14 right-0" id="timeline-classes"></div>
    </div>
  `;

  const timelineClasses = containerEl.querySelector("#timeline-classes");

  classes.forEach(cls => {
    const [sh, sm] = cls.startTime.split(":").map(Number);
    const [eh, em] = cls.endTime.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const durationMin = endMin - startMin;

    const top = ((startMin - timelineStart) / 30) * 48;
    const height = Math.max((durationMin / 30) * 48, 40);

    const status = getClassStatus(cls);
    const log = logs.find(l => l.classId === cls.id && l.date === todayYMD());
    const statusConfig = {
      attended: { badge: "badge-safe", text: "✓ Attended", dot: "bg-green-500" },
      absent:  { badge: "badge-danger", text: "✕ Absent", dot: "bg-red-500" },
      ongoing:  { badge: "bg-blue-500 text-white", text: "In Progress", dot: "bg-blue-500 animate-pulse" },
      upcoming: { badge: "bg-gray-100 text-ink", text: "Upcoming", dot: "bg-gray-400" },
      ended:    { badge: "bg-gray-100 text-muted", text: "Not logged", dot: "bg-gray-400" },
    }[status] || { badge: "bg-gray-100 text-ink", text: status, dot: "bg-gray-400" };

    const card = document.createElement("div");
    card.className = "absolute rounded-xl p-3 shadow-sm border-l-4 overflow-hidden";
    card.style.borderLeftColor = safeColor(cls.color);
    card.style.top = top + "px";
    card.style.height = height + "px";
    card.style.minHeight = "40px";
    card.style.background = "white";
    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-ink text-sm truncate">${escHtml(cls.name)}</p>
          <p class="text-muted text-xs mt-0.5">${cls.startTime} – ${cls.endTime}</p>
          ${cls.room ? `<p class="text-muted text-xs">📍 ${escHtml(cls.room)}</p>` : ""}

        </div>
        <div class="flex flex-col items-end gap-1">
          <span class="text-xs ${statusConfig.badge} px-2 py-0.5 rounded-full font-medium">${statusConfig.text}</span>
          <div class="w-2 h-2 rounded-full ${statusConfig.dot}"></div>
        </div>
      </div>
      ${status === "ongoing" || status === "upcoming" ? `
        <button class="mt-2 text-xs bg-soft px-3 py-1 rounded-lg hover:bg-gray-200 transition-colors font-medium"
          data-action="mark-attendance" data-class-id="${escAttr(cls.id)}" data-status="${escAttr(status)}">
          Mark Attendance
        </button>
      ` : ""}
    `;

    // Highlight if ongoing
    if (status === "ongoing") card.classList.add("ring-2", "ring-blue-400");

    timelineClasses.appendChild(card);
  });

  // Event delegation for mark-attendance buttons
  timelineClasses.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='mark-attendance']");
    if (!btn) return;
    const classId = btn.dataset.classId;
    if (classId) window.markClassAttendance(classId);
  });
}

export function renderFullTimetableView(classes, containerEl) {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayBorderColors = [
    "border-l-red-400", "border-l-blue-400", "border-l-emerald-400",
    "border-l-amber-400", "border-l-purple-400", "border-l-pink-400", "border-l-gray-400"
  ];

  const byDay = [[], [], [], [], [], [], []];
  classes.forEach(cls => {
    const days = Array.isArray(cls.dayOfWeek) ? cls.dayOfWeek : [cls.dayOfWeek];
    days.forEach(day => { byDay[day].push(cls); });
  });

  let html = "";
  for (let d = 0; d < 7; d++) {
    const dayClasses = byDay[d].sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (dayClasses.length === 0) continue;

    html += `
      <div class="border-l-4 ${dayBorderColors[d]} pl-3">
        <h3 class="font-semibold text-sm text-ink mb-2">${dayNames[d]}</h3>
        ${dayClasses.map(cls => `
          <div class="flex items-center gap-3 py-2 border-b border-gray-100 last:border-b-0">
            <span class="w-2 h-2 rounded-full shrink-0" style="background:${safeColor(cls.color)}"></span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-ink truncate">${escHtml(cls.name)}</p>
              <p class="text-xs text-muted">${cls.startTime} – ${cls.endTime}${cls.room ? " · " + escHtml(cls.room) : ""}${cls.teacher ? " · " + escHtml(cls.teacher) : ""}</p>
            </div>
            ${cls.shortCode ? `<span class="text-xs text-muted shrink-0">${escHtml(cls.shortCode)}</span>` : ""}
          </div>
        `).join("")}
      </div>
    `;
  }

  if (!html) {
    html = `<div class="text-center py-8 text-muted"><p>No classes scheduled. Use Manual Entry to create your timetable.</p></div>`;
  }

  containerEl.innerHTML = html;
}

