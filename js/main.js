/**
 * main.js — frontend orchestration.
 * Team 1's future backend only needs to satisfy data.js's JSON contract.
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
const fileError = document.getElementById("fileError");

let currentData = null;
let terrainMesh = null;
let wireOverlay = null;
let textureImage = null;
let showWireframe = false;
let showTexture = false;
let isFlythrough = false;
let flyStart = 0;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let probeSphere = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeaf3f3);
scene.fog = new THREE.FogExp2(0xeaf3f3, 0.0022);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(40, 40, 40);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
resizeRendererToDisplaySize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = true;
controls.minPolarAngle = 0.18;
controls.maxPolarAngle = Math.PI * 0.49;

scene.add(new THREE.HemisphereLight(0xf7ffff, 0x91aeb0, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(45, 75, 30);
scene.add(sun);
const fillLight = new THREE.DirectionalLight(0x9ddfe0, 0.7);
fillLight.position.set(-40, 25, -30);
scene.add(fillLight);

const gridHelper = new THREE.GridHelper(160, 32, 0x9fc3c7, 0xc6dfe0);
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
    fileError.textContent = "The terrain model could not be loaded. Please try another image.";
    fileError.classList.remove("hidden");
    uploadProgress.classList.add("hidden");
  }
}

function onElevationDataReady(data) {
  currentData = data;
  gridHelper.visible = true;
  renderDataSummary(data);
  renderLegend(data);
  renderTerrain(data);
  showControls();
  hideEmptyState();
}

function hideEmptyState() {
  document.getElementById("emptyState")?.classList.add("hidden");
}

function renderTerrain(data) {
  disposeTerrain();
  const range = data.max_elevation - data.min_elevation || 1;
  const heightScale = Math.max(data.width, data.height) / (range * 2.7);
  terrainMesh = buildTerrainMesh(data, showTexture ? textureImage : null, { heightScale });
  scene.add(terrainMesh);
  if (showWireframe) {
    wireOverlay = buildWireframeOverlay(data, heightScale);
    scene.add(wireOverlay);
  }
  frameCameraToMesh(terrainMesh);
}

function disposeTerrain() {
  if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); disposeMaterial(terrainMesh.material); terrainMesh = null; }
  if (wireOverlay) { scene.remove(wireOverlay); wireOverlay.geometry.dispose(); disposeMaterial(wireOverlay.material); wireOverlay = null; }
  if (probeSphere) { scene.remove(probeSphere); probeSphere.geometry.dispose(); disposeMaterial(probeSphere.material); probeSphere = null; }
}

function disposeMaterial(material) {
  if (material?.map) material.map.dispose();
  material?.dispose?.();
}

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
  probeReadout.innerHTML = `<div class="probe-active"><div class="probe-value" style="color:${elevationToColor((result.elevation-data.min_elevation)/range).getStyle()}">${result.elevation.toFixed(2)} ${unit}</div><div class="probe-meta"><span>Grid: (${result.x}, ${result.y})</span><span>Percentile: ${normalized}%</span><span>${data.path === "B" ? "absolute elevation" : "relative estimate"}</span></div></div>`;
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
resetViewBtn?.addEventListener("click", () => { stopFlythrough(); if(terrainMesh&&currentData)frameCameraToMesh(terrainMesh); });

function startFlythrough() {
  if (!terrainMesh) return;
  isFlythrough = true; flyStart = performance.now(); controls.enabled = false;
  flythroughBtn.classList.add("active"); flythroughBtn.innerHTML = "<span>■</span> Stop flythrough";
}
function stopFlythrough() {
  isFlythrough = false; controls.enabled = true;
  if (flythroughBtn) { flythroughBtn.classList.remove("active"); flythroughBtn.innerHTML = "<span>↗</span> Flythrough"; }
}

function renderDataSummary(data) {
  const steps = (data.pipeline || []).map(step => `<div class="pipeline-step done"><span>✓</span>${step}</div>`).join("");
  dataSummary.innerHTML = `<div class="summary-row"><span class="summary-label">Grid</span><span class="summary-value">${data.width} × ${data.height}</span></div><div class="summary-row"><span class="summary-label">Points</span><span class="summary-value">${(data.width*data.height).toLocaleString()}</span></div><div class="summary-row"><span class="summary-label">Range</span><span class="summary-value">${data.min_elevation.toFixed(1)} — ${data.max_elevation.toFixed(1)}</span></div><div class="summary-row"><span class="summary-label">Mode</span><span class="summary-value">${data.mock ? "MOCK / " : ""}${data.path === "B" ? "ABSOLUTE" : "RELATIVE"}</span></div><div class="pipeline-steps">${steps}</div>`;
}

function setProgress(percent,label){ uploadProgressBar.style.width=`${percent}%`; uploadProgressLabel.textContent=label; if(percent>=100)setTimeout(()=>uploadProgress.classList.add("hidden"),700); }
function setStatus(state){ statusBadge.className=`status-badge ${state}`; statusBadge.textContent=state.toUpperCase(); }
