/**
 * AttendX — timetable-upload.js
 * Drag-and-drop file upload with preview for images and PDFs.
 * Exposes: showUploadModal(), hideUploadModal()
 */

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_SIZE_MB = 10;

let _onFileReady = null; // callback(fileData, fileType) → called when file is ready for parsing

export function initUpload(onFileReady) {
  _onFileReady = onFileReady;
}

export function showUploadModal() {
  const existing = document.getElementById("timetable-upload-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "timetable-upload-modal";
  modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm";
  modal.innerHTML = `
    <div class="glass-card rounded-3xl p-6 w-full max-w-md mx-4">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold text-ink">Upload Timetable</h2>
        <button id="upload-modal-close" class="w-8 h-8 rounded-xl hover:bg-soft/80 flex items-center justify-center text-muted">✕</button>
      </div>

      <div id="drop-zone" class="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center cursor-pointer hover:border-accent transition-colors">
        <div class="text-4xl mb-3">📄</div>
        <p class="text-ink font-medium mb-1">Drag & drop your timetable here</p>
        <p class="text-muted text-sm mb-3">or click to browse</p>
        <p class="text-muted text-xs">Supports JPG, PNG, PDF (max ${MAX_SIZE_MB}MB)</p>
        <input type="file" id="file-input" accept=".jpg,.jpeg,.png,.pdf" class="hidden" />
      </div>

      <div id="upload-preview" class="hidden mt-4">
        <p class="text-ink font-medium mb-2">Preview</p>
        <div class="relative rounded-xl overflow-hidden bg-soft">
          <img id="preview-image" class="max-h-48 mx-auto rounded-xl" />
          <p id="preview-filename" class="text-muted text-xs mt-2 text-center"></p>
        </div>
        <button id="btn-parse-file" class="w-full mt-4 bg-accent text-white font-semibold py-3 rounded-xl hover:bg-accent/90 transition-colors">
          Parse Timetable
        </button>
      </div>

      <div id="upload-error" class="hidden mt-4 text-red-500 text-sm"></div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  modal.querySelector("#upload-modal-close").onclick = hideUploadModal;
  modal.querySelector("#drop-zone").onclick = () => modal.querySelector("#file-input").click();

  modal.querySelector("#file-input").addEventListener("change", (e) => handleFile(e.target.files[0], modal));

  // Drag-drop on modal
  const dropZone = modal.querySelector("#drop-zone");
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("border-accent"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("border-accent"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-accent");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file, modal);
  });

  // Click outside to close
  modal.addEventListener("click", (e) => { if (e.target === modal) hideUploadModal(); });
}

export function hideUploadModal() {
  const modal = document.getElementById("timetable-upload-modal");
  if (modal) modal.remove();
}

async function handleFile(file, modal) {
  const errorEl = modal.querySelector("#upload-error");
  errorEl.classList.add("hidden");

  if (!file) return;

  if (!ACCEPTED_TYPES.includes(file.type)) {
    showError(modal, "Please upload a JPG, PNG, or PDF file.");
    return;
  }

  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    showError(modal, `File is too large. Max size is ${MAX_SIZE_MB}MB.`);
    return;
  }

  const previewEl = modal.querySelector("#upload-preview");
  const imgEl = modal.querySelector("#preview-image");
  const filenameEl = modal.querySelector("#preview-filename");

  filenameEl.textContent = file.name;

  let fileData = null;
  let fileType = null;

  if (file.type === "application/pdf") {
    fileData = await fileToBase64(file);
    fileType = "pdf";
    imgEl.classList.add("hidden");
  } else {
    imgEl.classList.remove("hidden");
    fileData = await fileToBase64(file);
    fileType = "image";
    imgEl.src = fileData;
  }

  previewEl.classList.remove("hidden");
  imgEl._fileData = fileData;
  imgEl._fileType = fileType;

  // Wire up parse button
  modal.querySelector("#btn-parse-file").onclick = () => {
    if (fileData && _onFileReady) {
      _onFileReady(fileData, fileType, file);
      hideUploadModal();
    }
  };
}

function showError(modal, msg) {
  const el = modal.querySelector("#upload-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}