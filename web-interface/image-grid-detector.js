/**
 * AttendX — image-grid-detector.js
 * Client-side heuristic grid detection for timetable images.
 *
 * Detects table structure from images using Canvas pixel analysis:
 *   1. Scan rows for horizontal lines (grid borders)
 *   2. Scan columns for vertical lines
 *   3. Infer cell grid from detected lines
 *   4. Extract cell content regions for the editor
 *
 * No OCR — cells are detected as "has content" or "empty".
 * Falls through to manual editor if no grid found.
 */



/**
 * Attempt to detect a timetable grid in an image.
 * @param {string} imageDataUrl - Base64 data URL of the image
 * @returns {Promise<Array>} Array of detected class objects, or empty array if detection fails
 */
export async function detectGridFromImage(imageDataUrl) {
  try {
    const img = await loadImage(imageDataUrl);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // Scale down for performance (max 800px wide)
    const scale = Math.min(1, 800 / img.width);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { width, height } = imageData;

    // Detect grid lines
    const hLines = detectHorizontalLines(imageData, width, height);
    const vLines = detectVerticalLines(imageData, width, height);

    if (hLines.length < 3 || vLines.length < 3) {
      return []; // No clear grid found
    }

    // Extract cells from grid lines
    const cells = extractCells(imageData, ctx, canvas.width, hLines, vLines, scale);

    if (cells.length < 3) {
      return []; // Too few cells for a timetable
    }

    // Convert cells to class entries
    return cellsToClasses(cells);
  } catch (e) {
    console.warn("[ImageGridDetector] Detection failed:", e);
    return [];
  }
}

/**
 * Load an image from a data URL.
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Detect horizontal grid lines by scanning pixel rows.
 * Looks for rows where the average luminance drops (grid lines are darker).
 */
function detectHorizontalLines(imageData, width, height) {
  const lines = [];
  const threshold = 0.85; // Grid lines are typically much darker than background
  const minGap = Math.max(5, Math.round(height * 0.01)); // Minimum gap between lines
  const lineThickness = Math.max(2, Math.round(height * 0.003));

  for (let y = 0; y < height; y++) {
    const isDark = isRowDark(imageData, width, y, threshold);
    if (isDark) {
      // Check if this is part of a thicker line
      let thickness = 1;
      while (y + thickness < height && isRowDark(imageData, width, y + thickness, threshold)) {
        thickness++;
      }

      // Only accept if the previous line is far enough away
      if (lines.length === 0 || y - lines[lines.length - 1] > minGap) {
        lines.push(y);
        y += thickness - 1;
      }
    }
  }

  return lines;
}

/**
 * Detect vertical grid lines by scanning pixel columns.
 */
function detectVerticalLines(imageData, width, height) {
  const lines = [];
  const threshold = 0.85;
  const minGap = Math.max(5, Math.round(width * 0.005));
  const lineThickness = Math.max(2, Math.round(width * 0.003));

  for (let x = 0; x < width; x++) {
    const isDark = isColumnDark(imageData, height, width, x, threshold);
    if (isDark) {
      let thickness = 1;
      while (x + thickness < width && isColumnDark(imageData, height, width, x + thickness, threshold)) {
        thickness++;
      }

      if (lines.length === 0 || x - lines[lines.length - 1] > minGap) {
        lines.push(x);
        x += thickness - 1;
      }
    }
  }

  return lines;
}

/**
 * Check if a row is dark (part of a grid line).
 */
function isRowDark(imageData, width, y, threshold) {
  const data = imageData.data;
  let totalBrightness = 0;
  const start = y * width * 4;
  const sampleStep = Math.max(1, Math.floor(width / 20)); // Sample 20 points

  let sampled = 0;
  for (let x = 0; x < width; x += sampleStep) {
    const idx = start + x * 4;
    const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    totalBrightness += brightness;
    sampled++;
  }

  const avgBrightness = totalBrightness / sampled;
  return avgBrightness < 255 * (1 - threshold);
}

/**
 * Check if a column is dark (part of a grid line).
 */
function isColumnDark(imageData, height, width, x, threshold) {
  const data = imageData.data;
  let totalBrightness = 0;
  const sampleStep = Math.max(1, Math.floor(height / 20));

  let sampled = 0;
  for (let y = 0; y < height; y += sampleStep) {
    const idx = (y * width + x) * 4;
    const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
    totalBrightness += brightness;
    sampled++;
  }

  const avgBrightness = totalBrightness / sampled;
  return avgBrightness < 255 * (1 - threshold);
}

/**
 * Extract cell regions from detected grid lines.
 * Returns array of { row, col, x, y, width, height, hasContent }
 */
function extractCells(imageData, ctx, canvasWidth, hLines, vLines, scale) {
  const cells = [];

  for (let r = 0; r < hLines.length - 1; r++) {
    for (let c = 0; c < vLines.length - 1; c++) {
      const x1 = vLines[c];
      const y1 = hLines[r];
      const x2 = vLines[c + 1];
      const y2 = hLines[r + 1];

      const cellWidth = x2 - x1;
      const cellHeight = y2 - y1;

      if (cellWidth < 10 || cellHeight < 10) continue; // Too small

      // Check if cell has content (non-background pixels)
      const hasContent = regionHasContent(imageData, canvasWidth, x1, y1, x2, y2);

      cells.push({
        row: r,
        col: c,
        x: Math.round(x1 / scale),
        y: Math.round(y1 / scale),
        width: Math.round(cellWidth / scale),
        height: Math.round(cellHeight / scale),
        hasContent,
      });
    }
  }

  return cells;
}

/**
 * Check if a cell region contains significant non-background pixels.
 */
function regionHasContent(imageData, imageWidth, x1, y1, x2, y2) {
  const data = imageData.data;
  const threshold = 200; // Pixel is "content" if brightness < this
  const minContentRatio = 0.005; // At least 0.5% of pixels must be non-background

  let contentPixels = 0;
  let totalPixels = 0;

  // Sample within the cell (avoid borders)
  const margin = 2;
  const sx1 = Math.min(x1 + margin, x2);
  const sy1 = Math.min(y1 + margin, y2);
  const sx2 = Math.max(x2 - margin, sx1 + 1);
  const sy2 = Math.max(y2 - margin, sy1 + 1);

  const step = Math.max(1, Math.floor(Math.min(sx2 - sx1, sy2 - sy1) / 8));

  for (let y = sy1; y < sy2; y += step) {
    for (let x = sx1; x < sx2; x += step) {
      const idx = (y * imageWidth + x) * 4;
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      if (brightness < threshold) contentPixels++;
      totalPixels++;
    }
  }

  return totalPixels > 0 && (contentPixels / totalPixels) > minContentRatio;
}

/**
 * Attempt to map grid cells to timetable classes.
 *
 * Heuristic:
 * - First row -> day headers
 * - First column -> time slots
 * - Intersection cells -> class entries
 */
function cellsToClasses(cells) {
  if (cells.length === 0) return [];

  // Determine unique rows and columns
  const rows = [...new Set(cells.map(c => c.row))];
  const cols = [...new Set(cells.map(c => c.col))];

  if (rows.length < 3 || cols.length < 3) return [];

  // First row (after header row) is likely time slots
  const headerRow = rows[0];
  const dataRows = rows.slice(1);

  // First column (row 0 column 0 is corner cell)
  const timeCol = cols[0];
  const dataCols = cols.slice(1);

  // Extract day names from header row cells
  const dayNames = [];
  for (const col of dataCols) {
    const cell = cells.find(c => c.row === headerRow && c.col === col);
    if (cell && cell.hasContent) {
      dayNames.push({ col, name: "" }); // We can't read text, just mark the column
    }
  }

  if (dayNames.length < 3) return []; // Need at least 3 day columns

  // Extract time entries from first data column
  const timeEntries = [];
  for (const row of dataRows) {
    const cell = cells.find(c => c.row === row && c.col === timeCol);
    if (cell && cell.hasContent) {
      timeEntries.push({ row, timeText: "" });
    }
  }

  if (timeEntries.length === 0) return [];

  // Build classes from content cells in the grid
  const classes = [];
  const seen = new Set();

  for (const tEntry of timeEntries) {
    const row = tEntry.row;
    // Estimate time from row position
    const startHour = 8 + Math.floor((row - dataRows[0]) * 1); // Rough estimate
    const startTime = `${String(startHour).padStart(2, "0")}:00`;
    const endTime = `${String(startHour + 1).padStart(2, "0")}:00`;

    for (const dayCol of dataCols) {
      const cell = cells.find(c => c.row === row && c.col === dayCol);
      if (!cell || !cell.hasContent) continue;

      const dayIdx = dataCols.indexOf(dayCol);

      const key = `${dayIdx}_${startTime}`;
      if (seen.has(key)) continue;
      seen.add(key);

      classes.push({
        id: `cls_img_${Date.now()}_${classes.length}`,
        name: "Detected Class",
        shortCode: "",
        color: "#6366F1",
        dayOfWeek: [dayIdx + 1], // Mon=1, Sun=0
        startTime,
        endTime,
        room: "",
        teacher: "",
      });
    }
  }

  return classes;
}
