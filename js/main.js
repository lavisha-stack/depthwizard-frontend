/**
 * main.js — frontend orchestration.
 * Team 1's backend only needs to satisfy data.js's unified JSON contract.
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
const meshMeta = document.getElementById("meshMeta");
const renderNote = document.getElementById("renderNote");

let currentData = null;
let terrainMesh = null;
let wireOverlay = null;
let textureImage = null;
let showWireframe = false;
let showTexture = false;
let isFlythrough = false;
let flyStart = 0;
let activePath = "A";
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let probeSphere = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1724);
scene.fog = new THREE.FogExp2(0x0a1724, 0.0022);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(40, 40, 40);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
resizeRendererToDisplaySize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = true;
controls.minPolarAngle = 0.18;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0xdffaff, 0x142638, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 1.55);
sun.position.set(45, 75, 30);
scene.add(sun);
const fillLight = new THREE.DirectionalLight(0x62c9df, 0.45);
fillLight.position.set(-40, 25, -30);
scene.add(fillLight);

const gridHelper = new THREE.GridHelper(160, 32, 0x1b3a4e, 0x102b3c);
gridHelper.position.y = -0.1;
gridHelper.visible = false;
scene.add(gridHelper);

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
  const altitude = Math.max(size.y * 1.25, 12) + Math.sin(elapsed * 0.35) * Math.max(size.y * .25, 3);
  camera.position.set(center.x + Math.cos(angle) * radius, center.y + altitude, center.z + Math.sin(angle) * radius);
  controls.target.copy(center);
  if (flyAltitude && currentData) flyAltitude.textContent = `${Math.round(Math.max(0, altitude))} m`;
}

// Upload UI
 dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-active"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-active"));
dropZone.addEventListener("drop", (e) => { e.preventDefault(); dropZone.classList.remove("drag-active"); const file = e.dataTransfer.files?.[0]; if (file) handleFile(file); });
fileInput.addEventListener("change", () => { const file = fileInput.files?.[0]; if (file) handleFile(file); });

async function handleFile(file) {
  fileError.classList.add("hidden");
  const acceptedTypes = ["image/png", "image/jpeg", "image/tiff"];
  const extension = file.name.toLowerCase().split(".").pop();
  const acceptedExtensions = ["png", "jpg", "jpeg", "tif", "tiff"];
  if ((!acceptedTypes.includes(file.type) && !acceptedExtensions.includes(extension)) || file.size > 25 * 1024 * 1024) {
    fileError.textContent = file.size > 25 * 1024 * 1024 ? "This image is larger than 25 MB." : "Please choose a PNG, JPG, or TIFF image.";
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

  const imagePromise = loadImageFile(file).catch(() => null);
  try {
    const elevationData = await getElevationData(file, setProgress);
    textureImage = await imagePromise;
    onElevationDataReady(elevationData);
    setStatus("ready");
  } catch (err) {
    console.error(err);
    setStatus("error");
    markPipelineError();
    fileError.textContent = "The terrain model could not be loaded. Please try another image.";
    fileError.classList.remove("hidden");
    uploadProgress.classList.add("hidden");
  }
}

function preparePipeline(file, path) {
  const extension = file.name.toLowerCase().split(".").pop();
  const isGeo = path === "B";
  imageType.textContent = extension.toUpperCase();
  geoStatus.textContent = isGeo ? "DETECTED" : "NOT DETECTED";
  pathValue.textContent = isGeo ? "PATH B · ABSOLUTE" : "PATH A · RELATIVE";
  pipelineMode.textContent = isGeo ? "ABSOLUTE" : "RELATIVE";
  pathBanner.className = `path-banner active${isGeo ? " path-b" : ""}`;
  pathALabel.classList.toggle("hidden", isGeo);
  pathBLabel.classList.toggle("hidden", !isGeo);
  pipelineA.classList.toggle("hidden", isGeo);
  pipelineB.classList.toggle("hidden", !isGeo);
  document.getElementById(isGeo ? "fileNameB" : "fileNameA").textContent = file.name;
  resetPipelineStages(isGeo ? pipelineB : pipelineA);
  viewerStatus.textContent = "PROCESSING PIPELINE";
  renderNote.textContent = isGeo ? "GeoTIFF detected · calibrating metric terrain." : "Standard imagery detected · building relative terrain.";
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
  const received = list.querySelector('[data-stage="received"]');
  received?.classList.add("processing");
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
  pipelineMode.textContent = label?.includes("ready") ? (activePath === "B" ? "ABSOLUTE" : "RELATIVE") : "RUNNING";
}

function markPipelineComplete(data) {
  const list = activePath === "B" ? pipelineB : pipelineA;
  list.querySelectorAll(".pipeline-step").forEach(step => setPipelineStage(step.dataset.stage, "done"));
  pipelineMode.textContent = activePath === "B" ? "ABSOLUTE" : "RELATIVE";
  pathValue.textContent = activePath === "B" ? "PATH B · ABSOLUTE" : "PATH A · RELATIVE";
}

function markPipelineError() {
  const list = activePath === "B" ? pipelineB : pipelineA;
  const current = list.querySelector(".pipeline-step.processing");
  current?.classList.replace("processing", "error");
  pipelineMode.textContent = "ERROR";
}

function onElevationDataReady(data) {
  currentData = data;
  activePath = data.path || activePath;
  markPipelineComplete(data);
  gridHelper.visible = true;
  renderDataSummary(data);
  renderLegend(data);
  renderTerrain(data);
  showControls();
  hideEmptyState();
  setOutputState("mesh", "done", `${(data.width * data.height).toLocaleString()} vertices`);
  setOutputState("texture", "done", textureImage ? "Original imagery draped" : "Image unavailable");
  setOutputState("viewer", "done", "Interactive WebGL terrain");
  viewerStatus.textContent = "TERRAIN READY";
  renderNote.textContent = `${activePath === "B" ? "Absolute DSM" : "Relative rDSM"} reconstructed · click terrain to probe.`;
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
  const range = data.max_elevation - data.min_elevation || 1;
  const heightScale = Math.max(data.width, data.height) / (range * 2.7);
  terrainMesh = buildTerrainMesh(data, showTexture ? textureImage : null, { heightScale });
  scene.add(terrainMesh);
  if (showWireframe) { wireOverlay = buildWireframeOverlay(data, heightScale); scene.add(wireOverlay); }
  frameCameraToMesh(terrainMesh);
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
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const dist = maxDim * 1.65;
  camera.position.set(center.x + dist * .78, center.y + dist * .72, center.z + dist * .78);
  controls.target.copy(center);
  controls.minDistance = maxDim * .22;
  controls.maxDistance = maxDim * 6;
  controls.update();
}

// Probe
canvas.addEventListener("click", (e) => {
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
  const unit = data.path === "B" ? "m" : "";
  probeReadout.innerHTML = `<div class="probe-active"><div class="probe-value">${result.elevation.toFixed(2)} ${unit}</div><div class="probe-meta"><span>Grid: (${result.x}, ${result.y})</span><span>Percentile: ${normalized}%</span><span>${data.path === "B" ? "absolute elevation" : "relative estimate"}</span></div></div>`;
}

function showProbeMarker(point, elevation, data) {
  if (probeSphere) { scene.remove(probeSphere); probeSphere.geometry.dispose(); disposeMaterial(probeSphere.material); }
  const range = data.max_elevation - data.min_elevation || 1;
  const color = elevationToColor((elevation - data.min_elevation) / range);
  probeSphere = new THREE.Mesh(new THREE.SphereGeometry(.8, 16, 16), new THREE.MeshBasicMaterial({ color }));
  probeSphere.position.copy(point); probeSphere.position.y += .5; scene.add(probeSphere);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 32), new THREE.MeshBasicMaterial({ color, side:THREE.DoubleSide, transparent:true, opacity:.55 }));
  ring.rotation.x = -Math.PI/2; ring.position.copy(point); ring.position.y += .1; probeSphere.add(ring);
  const start = performance.now();
  const pulse = () => { if (!probeSphere) return; const s = 1 + Math.sin((performance.now()-start)/1000*3)*.25; ring.scale.setScalar(s); requestAnimationFrame(pulse); };
  pulse();
}

function renderLegend(data) {
  const unit = data.path === "B" ? "m" : "";
  legendMin.textContent = `${data.min_elevation.toFixed(1)} ${unit}`;
  legendMax.textContent = `${data.max_elevation.toFixed(1)} ${unit}`;
  const stops = Array.from({length:21}, (_,i) => { const c=elevationToColor(i/20); return `${c.getStyle()} ${i*5}%`; });
  legendBar.style.background = `linear-gradient(to right, ${stops.join(",")})`;
}

function showControls() { document.querySelectorAll(".terrain-control").forEach(el => { el.classList.remove("hidden"); el.classList.add("fade-in"); }); }

toggleWireframeBtn?.addEventListener("click", () => { showWireframe=!showWireframe; toggleWireframeBtn.classList.toggle("active",showWireframe); if(currentData)renderTerrain(currentData); });
toggleTextureBtn?.addEventListener("click", () => { showTexture=!showTexture; toggleTextureBtn.classList.toggle("active",showTexture); if(currentData)renderTerrain(currentData); });
flythroughBtn?.addEventListener("click", () => { if(isFlythrough) stopFlythrough(); else startFlythrough(); });
exitFlythroughBtn?.addEventListener("click", stopFlythrough);
resetViewBtn?.addEventListener("click", () => { stopFlythrough(); if(terrainMesh&&currentData)frameCameraToMesh(terrainMesh); });

function startFlythrough() {
  if (!terrainMesh) return;
  isFlythrough = true; flyStart = performance.now(); controls.enabled = false;
  flythroughBtn.classList.add("active"); flythroughBtn.textContent = "■ Stop flythrough";
  flyHud.classList.remove("hidden"); hudCamera.textContent = "DRONE"; flyModel.textContent = activePath === "B" ? "ABS DSM" : "rDSM";
}
function stopFlythrough() {
  isFlythrough = false; controls.enabled = true;
  if (flythroughBtn) { flythroughBtn.classList.remove("active"); flythroughBtn.textContent = "↗ Flythrough"; }
  flyHud?.classList.add("hidden"); hudCamera.textContent = "ORBIT";
}

function renderDataSummary(data) {
  dataSummary.innerHTML = `<div class="summary-row"><span class="summary-label">GRID</span><span class="summary-value">${data.width} × ${data.height}</span></div><div class="summary-row"><span class="summary-label">POINTS</span><span class="summary-value">${(data.width*data.height).toLocaleString()}</span></div><div class="summary-row"><span class="summary-label">RANGE</span><span class="summary-value">${data.min_elevation.toFixed(1)} — ${data.max_elevation.toFixed(1)}</span></div><div class="summary-row"><span class="summary-label">MODEL</span><span class="summary-value">${data.path === "B" ? "ABSOLUTE DSM" : "RELATIVE rDSM"}</span></div>`;
}

function setProgress(percent,label){ uploadProgressBar.style.width=`${percent}%`; uploadProgressValue.textContent=`${Math.round(percent)}%`; uploadProgressLabel.textContent=label; setPipelineProgress(percent,label); if(percent>=100)setTimeout(()=>uploadProgress.classList.add("hidden"),700); }
function setStatus(state){ statusBadge.className=`status-badge ${state}`; statusBadge.textContent=state.toUpperCase(); }
