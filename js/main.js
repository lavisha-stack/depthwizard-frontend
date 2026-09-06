/**
 * main.js — frontend orchestration (FIXED).
 * The backend is the source of truth for terrain data and path selection.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getElevationData, loadImageFile } from "./data.js";
import { buildTerrainMesh, buildWireframeOverlay, probeTerrain, elevationToColor } from "./mesh.js";

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const uploadProgress = document.getElementById("uploadProgress");
const uploadProgressBar = document.getElementById("uploadProgressBar");
const uploadProgressLabel = document.getElementById("uploadProgressLabel");
const uploadProgressValue = document.getElementById("uploadProgressValue");
const statusBadge = document.getElementById("statusBadge");
const dataSummary = document.getElementById("dataSummary");
const probeReadout = document.getElementById("probeReadout");
const canvas = document.getElementById("viewport");
const legendBar = document.getElementById("legendBar");
const legendMin = document.getElementById("legendMin");
const legendMax = document.getElementById("legendMax");
const toggleWireframeBtn = document.getElementById("toggleWireframe");
const toggleTextureBtn = document.getElementById("toggleTexture");
const flythroughBtn = document.getElementById("flythroughBtn");
const resetViewBtn = document.getElementById("resetView");
const exitFlythroughBtn = document.getElementById("exitFlythrough");
const fileError = document.getElementById("fileError");
const imageType = document.getElementById("imageType");
const geoStatus = document.getElementById("geoStatus");
const pathBanner = document.getElementById("pathBanner");
const pathValue = document.getElementById("pathValue");
const pipelineMode = document.getElementById("pipelineMode");
const pipelineA = document.getElementById("pipelineA");
const pipelineB = document.getElementById("pipelineB");
const pathALabel = document.getElementById("pathALabel");
const pathBLabel = document.getElementById("pathBLabel");
const viewerStatus = document.getElementById("viewerStatus");
const hudMode = document.getElementById("hudMode");
const hudCamera = document.getElementById("hudCamera");
const flyHud = document.getElementById("flyHud");
const flyAltitude = document.getElementById("flyAltitude");
const flyModel = document.getElementById("flyModel");
const renderNote = document.getElementById("renderNote");

let currentData = null;
let terrainMesh = null;
let wireOverlay = null;
let textureImage = null;
let showWireframe = false;
// RGB imagery is the default judge-facing surface. Heatmap colors are the optional fallback/view.
let showTexture = true;
let isFlythrough = false;
let flyStart = 0;
let activePath = "A";
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let probeSphere = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07131e);
scene.fog = new THREE.FogExp2(0x07131e, 0.0014);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(40, 40, 40);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
resizeRendererToDisplaySize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = true;
controls.minPolarAngle = 0.18;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0xcce8ff, 0x263428, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.45);
sun.position.set(-80, 120, -90);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -200;
sun.shadow.camera.right = 200;
sun.shadow.camera.top = 200;
sun.shadow.camera.bottom = -200;
sun.shadow.camera.near = 0.1;
sun.shadow.camera.far = 1000;
sun.shadow.bias = -0.0001;
scene.add(sun);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
fillLight.position.set(50, 50, 40);
scene.add(fillLight);

const gridHelper = new THREE.GridHelper(180, 36, 0x397d96, 0x5aa5ba);
gridHelper.material.opacity = 0.42;
gridHelper.material.transparent = true;
gridHelper.position.y = -0.5;
gridHelper.visible = true;
scene.add(gridHelper);

toggleTextureBtn?.classList.add("active");
animate();
window.addEventListener("resize", resizeRendererToDisplaySize);

function resizeRendererToDisplaySize() {
  const width = Math.max(canvas.clientWidth, 1);
  const height = Math.max(canvas.clientHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate(time = 0) {
  requestAnimationFrame(animate);
  if (isFlythrough && terrainMesh && currentData) updateFlythrough(time);
  controls.update();
  renderer.render(scene, camera);
}

function updateFlythrough(time) {
  const box = new THREE.Box3().setFromObject(terrainMesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.z) * 0.72;
  const elapsed = (time - flyStart) / 1000;
  const angle = elapsed * 0.16;
  const altitude = Math.max(size.y * 1.25, Math.max(size.x, size.z) * 0.08) + Math.sin(elapsed * 0.35) * Math.max(size.y * 0.25, 2);
  camera.position.set(center.x + Math.cos(angle) * radius, center.y + altitude, center.z + Math.sin(angle) * radius);
  controls.target.copy(center);
  if (flyAltitude && currentData) flyAltitude.textContent = `${Math.round(Math.max(0, altitude))} m`;
}

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-active"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-active"));
dropZone.addEventListener("drop", e => { e.preventDefault(); dropZone.classList.remove("drag-active"); const file = e.dataTransfer.files?.[0]; if (file) handleFile(file); });
fileInput.addEventListener("change", () => { const file = fileInput.files?.[0]; if (file) handleFile(file); });

async function handleFile(file) {
  fileError.classList.add("hidden");
  const acceptedTypes = ["image/png", "image/jpeg", "image/tiff"];
  const extension = file.name.toLowerCase().split(".").pop();
  const acceptedExtensions = ["png", "jpg", "jpeg", "tif", "tiff"];
  if ((!acceptedTypes.includes(file.type) && !acceptedExtensions.includes(extension)) || file.size > 500 * 1024 * 1024) {
    fileError.textContent = file.size > 500 * 1024 * 1024 ? "This image is larger than 500 MB." : "Please choose a PNG, JPG, or TIFF image.";
    fileError.classList.remove("hidden");
    setStatus("error");
    return;
  }

  activePath = ["tif", "tiff"].includes(extension) ? "B" : "A";
  preparePipeline(file, activePath);
  setStatus("processing");
  uploadProgress.classList.remove("hidden");
  setProgress(0, "Starting pipeline…");
  stopFlythrough();
  disposeTextureImage();

  try {
    console.log(`Processing file: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    const elevationData = await getElevationData(file, setProgress);
    console.log("Elevation data received, loading texture...");
    textureImage = await loadImageFile(file, elevationData.texture_url).catch(() => null);
    onElevationDataReady(elevationData);
    setStatus("ready");
  } catch (err) {
    console.error("Pipeline error:", err);
    setStatus("error");
    markPipelineError();
    fileError.textContent = err?.message || "The terrain model could not be loaded. Please try another image.";
    fileError.classList.remove("hidden");
    uploadProgress.classList.add("hidden");
  }
}

function disposeTextureImage() {
  if (textureImage?.__depthwizardObjectUrl) URL.revokeObjectURL(textureImage.__depthwizardObjectUrl);
  textureImage = null;
}

function preparePipeline(file, path) {
  const extension = file.name.toLowerCase().split(".").pop();
  const isTiffCandidate = ["tif", "tiff"].includes(extension);
  imageType.textContent = extension.toUpperCase();
  geoStatus.textContent = isTiffCandidate ? "PENDING" : "NOT DETECTED";
  pathValue.textContent = isTiffCandidate ? "PATH B · CHECKING" : "PATH A · RELATIVE";
  pipelineMode.textContent = isTiffCandidate ? "CHECKING" : "RELATIVE";
  pathBanner.className = `path-banner active${isTiffCandidate ? " path-b" : ""}`;
  pathALabel.classList.toggle("hidden", isTiffCandidate);
  pathBLabel.classList.toggle("hidden", !isTiffCandidate);
  pipelineA.classList.toggle("hidden", isTiffCandidate);
  pipelineB.classList.toggle("hidden", !isTiffCandidate);
  document.getElementById(isTiffCandidate ? "fileNameB" : "fileNameA").textContent = file.name;
  resetPipelineStages(isTiffCandidate ? pipelineB : pipelineA);
  viewerStatus.textContent = "Processing…";
  renderNote.textContent = isTiffCandidate ? "TIFF candidate — checking georeference before metric calibration." : "Standard image — building relative terrain.";
  setOutputState("mesh", "waiting", "Waiting");
  setOutputState("texture", "waiting", "Original imagery draped");
  setOutputState("viewer", "waiting", "Interactive WebGL terrain");
}

function resetPipelineStages(list) {
  document.querySelectorAll(".pipeline-step").forEach(step => {
    step.classList.remove("done", "processing", "error");
    const icon = step.querySelector(".step-icon");
    if (icon && step.dataset.stage !== "received") icon.textContent = icon.dataset.number || icon.textContent;
  });
  list.querySelector('[data-stage="received"]')?.classList.add("processing");
}

function setPipelineStage(stage, state = "done") {
  const list = activePath === "B" ? pipelineB : pipelineA;
  const el = list.querySelector(`[data-stage="${stage}"]`);
  if (!el) return;
  el.classList.remove("done", "processing", "error");
  el.classList.add(state);
  const icon = el.querySelector(".step-icon");
  if (state === "done") icon.textContent = "✓";
  if (state === "processing") icon.textContent = "•";
}

function setPipelineProgress(percent, label) {
  const stages = activePath === "B"
    ? [[0,"received"],[16,"analyzer"],[42,"depth"],[58,"relative"],[70,"anchor"],[82,"calibration"],[96,"adsm"]]
    : [[0,"received"],[16,"analyzer"],[42,"depth"],[58,"relative"],[82,"rdsm"]];
  let current = stages[0][1];
  for (const [threshold, stage] of stages) if (percent >= threshold) current = stage;
  const currentIndex = stages.findIndex(([, stage]) => stage === current);
  stages.forEach(([, stage], index) => setPipelineStage(stage, index < currentIndex ? "done" : index === currentIndex ? "processing" : "waiting"));
  pipelineMode.textContent = label?.includes("ready") ? (activePath === "B" ? "CHECK RESULT" : "RELATIVE") : "RUNNING";
}

function markPipelineComplete(data) {
  activePath = data.path || activePath;
  const list = activePath === "B" ? pipelineB : pipelineA;
  list.querySelectorAll(".pipeline-step").forEach(step => setPipelineStage(step.dataset.stage, "done"));
  const calibrated = data.path === "B" && data.georeferenced === true && data.calibrated === true && data.elevation_unit === "m";
  const relative = data.elevation_unit !== "m";
  pipelineMode.textContent = calibrated ? "ABSOLUTE" : relative ? "RELATIVE" : "ESTIMATED";
  pathValue.textContent = calibrated ? "PATH B · ABSOLUTE" : data.path === "B" ? "PATH B · UNCALIBRATED" : "PATH A · RELATIVE";
}

function markPipelineError() {
  const list = activePath === "B" ? pipelineB : pipelineA;
  list.querySelector(".pipeline-step.processing")?.classList.replace("processing", "error");
  pipelineMode.textContent = "ERROR";
}

function onElevationDataReady(data) {
  currentData = data;
  activePath = data.path || activePath;
  markPipelineComplete(data);
  renderDataSummary(data);
  renderLegend(data);
  renderTerrain(data);
  showControls();
  hideEmptyState();
  setOutputState("mesh", "done", `${(data.width * data.height).toLocaleString()} vertices`);
  setOutputState("texture", "done", textureImage ? "Source RGB draped" : "RGB unavailable");
  setOutputState("viewer", "done", "Interactive WebGL terrain");
  viewerStatus.textContent = "Terrain ready";

  const calibrated = data.path === "B" && data.georeferenced === true && data.calibrated === true && data.elevation_unit === "m";
  renderNote.textContent = calibrated
    ? "✓ Absolute DSM ready — click the surface to inspect calibrated elevation."
    : data.path === "B"
      ? "⚠ Terrain rendered — metric calibration is not confirmed for this result."
      : "✓ Relative terrain ready — click the surface to inspect relative height.";
}

function setOutputState(name, state, detail) {
  const el = document.querySelector(`[data-output="${name}"]`);
  if (!el) return;
  el.classList.remove("done", "active");
  if (state === "done") el.classList.add("done");
  if (state === "active") el.classList.add("active");
  const icon = el.querySelector("span");
  if (icon) icon.textContent = state === "done" ? "✓" : state === "active" ? "●" : "○";
  const small = el.querySelector("small");
  if (small && detail) small.textContent = detail;
}

function hideEmptyState() { document.getElementById("emptyState")?.classList.add("hidden"); }

function renderTerrain(data) {
  disposeTerrain();
  const options = { verticalExaggeration: data.elevation_unit === "relative" ? 1 : 1 };
  terrainMesh = buildTerrainMesh(data, showTexture ? textureImage : null, options);
  scene.add(terrainMesh);
  if (showWireframe) { wireOverlay = buildWireframeOverlay(data, options); scene.add(wireOverlay); }
  frameCameraToMesh(terrainMesh);
  const maxDim = Math.max(terrainMesh.userData.worldWidth, terrainMesh.userData.worldDepth, 1);
  gridHelper.scale.setScalar(Math.max(1, maxDim / 180));
  hudMode.textContent = showTexture ? "RGB" : showWireframe ? "WIREFRAME" : "SURFACE";
}

function disposeTerrain() {
  if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); disposeMaterial(terrainMesh.material); terrainMesh = null; }
  if (wireOverlay) { scene.remove(wireOverlay); wireOverlay.geometry.dispose(); disposeMaterial(wireOverlay.material); wireOverlay = null; }
  if (probeSphere) { scene.remove(probeSphere); probeSphere.geometry.dispose(); disposeMaterial(probeSphere.material); probeSphere = null; }
}
function disposeMaterial(material) { if (material?.map) material.map.dispose(); material?.dispose?.(); }

function frameCameraToMesh(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const horizontal = Math.max(size.x, size.z, 1);
  const dist = horizontal * 1.35;
  camera.position.set(center.x + dist * 0.78, center.y + Math.max(dist * 0.72, size.y * 2.8 + 6), center.z + dist * 0.78);
  controls.target.copy(center);
  controls.minDistance = horizontal * 0.16;
  controls.maxDistance = horizontal * 5;
  controls.update();
}

canvas.addEventListener("click", e => {
  if (!terrainMesh || !currentData || isFlythrough) return;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const result = probeTerrain(raycaster, camera, mouse, terrainMesh, currentData);
  if (result) { renderProbeReadout(result, currentData); showProbeMarker(result.point, result.elevation, currentData); }
});

function renderProbeReadout(result, data) {
  const range = data.max_elevation - data.min_elevation || 1;
  const normalized = ((result.elevation - data.min_elevation) / range * 100).toFixed(1);
  const calibrated = data.path === "B" && data.georeferenced === true && data.calibrated === true && data.elevation_unit === "m";
  const unit = calibrated ? "m" : "rel";
  const label = calibrated ? "absolute height" : "relative estimate";
  probeReadout.innerHTML = `<div class="probe-active"><div class="probe-value">${result.elevation.toFixed(2)} ${unit}</div><div class="probe-meta"><span>Grid: (${result.x}, ${result.y})</span><span>Percentile: ${normalized}%</span></div><div class="probe-label">${label}</div></div>`;
}

function showProbeMarker(point, elevation, data) {
  if (probeSphere) { scene.remove(probeSphere); probeSphere.geometry.dispose(); disposeMaterial(probeSphere.material); }
  const range = data.max_elevation - data.min_elevation || 1;
  const color = elevationToColor((elevation - data.min_elevation) / range);
  probeSphere = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 16), new THREE.MeshBasicMaterial({ color }));
  probeSphere.position.copy(point); probeSphere.position.y += 0.5; scene.add(probeSphere);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
  ring.rotation.x = -Math.PI / 2; ring.position.copy(point); ring.position.y += 0.1; probeSphere.add(ring);
  const start = performance.now();
  const pulse = () => { if (!probeSphere) return; const s = 1 + Math.sin((performance.now() - start) / 1000 * 3) * 0.25; ring.scale.setScalar(s); requestAnimationFrame(pulse); };
  pulse();
}

function renderLegend(data) {
  const calibrated = data.path === "B" && data.georeferenced === true && data.calibrated === true && data.elevation_unit === "m";
  const unit = calibrated ? "m" : "rel";
  legendMin.textContent = `${data.min_elevation.toFixed(1)} ${unit}`;
  legendMax.textContent = `${data.max_elevation.toFixed(1)} ${unit}`;
  const stops = Array.from({ length: 21 }, (_, i) => { const c = elevationToColor(i / 20); return `${c.getStyle()} ${i * 5}%`; });
  legendBar.style.background = `linear-gradient(to right, ${stops.join(",")})`;
}

function showControls() { document.querySelectorAll(".terrain-control").forEach(el => { el.classList.remove("hidden"); el.classList.add("fade-in"); }); }

toggleWireframeBtn?.addEventListener("click", () => { showWireframe = !showWireframe; toggleWireframeBtn.classList.toggle("active", showWireframe); if (currentData) renderTerrain(currentData); });
toggleTextureBtn?.addEventListener("click", () => { showTexture = !showTexture; toggleTextureBtn.classList.toggle("active", showTexture); if (currentData) renderTerrain(currentData); });
flythroughBtn?.addEventListener("click", () => { if (isFlythrough) stopFlythrough(); else startFlythrough(); });
exitFlythroughBtn?.addEventListener("click", stopFlythrough);
resetViewBtn?.addEventListener("click", () => { stopFlythrough(); if (terrainMesh && currentData) frameCameraToMesh(terrainMesh); });

function startFlythrough() {
  if (!terrainMesh) return;
  isFlythrough = true; flyStart = performance.now(); controls.enabled = false;
  flythroughBtn.classList.add("active"); flythroughBtn.textContent = "■ Stop";
  flyHud.classList.remove("hidden"); hudCamera.textContent = "DRONE"; flyModel.textContent = activePath === "B" ? "DSM" : "rDSM";
}
function stopFlythrough() {
  isFlythrough = false; controls.enabled = true;
  if (flythroughBtn) { flythroughBtn.classList.remove("active"); flythroughBtn.textContent = "↗ Flythrough"; }
  flyHud?.classList.add("hidden"); hudCamera.textContent = "ORBIT";
}

function renderDataSummary(data) {
  const calibrated = data.path === "B" && data.georeferenced === true && data.calibrated === true && data.elevation_unit === "m";
  const modelType = calibrated ? "Absolute DSM" : data.path === "B" ? "Uncalibrated surface" : "Relative rDSM";
  const rangeUnit = calibrated ? " m" : " relative";
  dataSummary.innerHTML = `<div class="summary-row"><span class="summary-label">Grid Size</span><span class="summary-value">${data.width} × ${data.height}</span></div><div class="summary-row"><span class="summary-label">Model Type</span><span class="summary-value">${modelType}</span></div><div class="summary-row"><span class="summary-label">Elevation Range</span><span class="summary-value">${(data.max_elevation - data.min_elevation).toFixed(1)}${rangeUnit}</span></div><div class="summary-row"><span class="summary-label">Path</span><span class="summary-value">${data.path}</span></div>`;
}

function setProgress(percent, label) { uploadProgressBar.style.width = `${percent}%`; uploadProgressValue.textContent = `${Math.round(percent)}%`; uploadProgressLabel.textContent = label; setPipelineProgress(percent, label); }
function setStatus(state) { statusBadge.className = `status-badge ${state}`; statusBadge.textContent = state.toUpperCase(); }
