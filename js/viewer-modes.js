// Viewer presentation layer. It intentionally drives the existing main.js controls
// instead of duplicating Three.js state, keeping the mock/API boundary unchanged.
const modeButtons = Array.from(document.querySelectorAll(".viewport-tool-group .tool-label"));
const wireBtn = document.getElementById("toggleWireframe");
const textureBtn = document.getElementById("toggleTexture");
const flyBtn = document.getElementById("flythroughBtn");

function setMode(mode) {
  if (!wireBtn || !textureBtn) return;
  if (mode === "SURFACE") {
    if (wireBtn.classList.contains("active")) wireBtn.click();
    if (textureBtn.classList.contains("active")) textureBtn.click();
  } else if (mode === "RGB") {
    if (wireBtn.classList.contains("active")) wireBtn.click();
    if (!textureBtn.classList.contains("active")) textureBtn.click();
  } else if (mode === "WIREFRAME") {
    if (textureBtn.classList.contains("active")) textureBtn.click();
    if (!wireBtn.classList.contains("active")) wireBtn.click();
  }
  syncModeLabels(mode);
}

function syncModeLabels(mode) {
  modeButtons.forEach((button) => {
    const active = button.textContent.trim().toUpperCase() === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

modeButtons.forEach((button) => {
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.addEventListener("click", () => setMode(button.textContent.trim().toUpperCase()));
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setMode(button.textContent.trim().toUpperCase());
    }
  });
});

wireBtn?.addEventListener("click", () => {
  if (wireBtn.classList.contains("active")) syncModeLabels("WIREFRAME");
  else syncModeLabels(textureBtn?.classList.contains("active") ? "RGB" : "SURFACE");
});

textureBtn?.addEventListener("click", () => {
  if (textureBtn.classList.contains("active")) syncModeLabels("RGB");
  else syncModeLabels(wireBtn?.classList.contains("active") ? "WIREFRAME" : "SURFACE");
});

flyBtn?.addEventListener("click", () => {
  document.querySelector(".viewport-container")?.classList.toggle("fly-active", flyBtn.classList.contains("active"));
});

syncModeLabels("SURFACE");
