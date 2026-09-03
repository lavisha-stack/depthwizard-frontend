/**
 * main.js — Entry point. Wires together:
 *   1. Upload UI (drag/drop + click-to-browse)
 *   2. Data fetching (via data.js)
 *   3. Three.js scene setup
 *   4. Terrain mesh building from elevation data
 *   5. Click-to-probe raycasting
 *   6. Camera auto-framing & controls
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getElevationData, loadImageFile } from "./data.js";
import {
  buildTerrainMesh,
  buildWireframeOverlay,
  probeTerrain,
  elevationToColor,
} from "./mesh.js";

// ---------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const uploadProgress = document.getElementById("uploadProgress");
const uploadProgressBar = document.getElementById("uploadProgressBar");
const uploadProgressLabel = document.getElementById("uploadProgressLabel");
const statusBadge = document.getElementById("statusBadge");
const dataSummary = document.getElementById("dataSummary");
const probeReadout = document.getElementById("probeReadout");
const canvas = document.getElementById("viewport");
const viewportHint = document.getElementById("viewportHint");
const legendBar = document.getElementById("legendBar");
const legendMin = document.getElementById("legendMin");
const legendMax = document.getElementById("legendMax");
const toggleWireframeBtn = document.getElementById("toggleWireframe");
const toggleTextureBtn = document.getElementById("toggleTexture");
const resetViewBtn = document.getElementById("resetView");
const fileError = document.getElementById("fileError");

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let currentData = null;
let terrainMesh = null;
let wireOverlay = null;
let textureImage = null;
let showWireframe = false;
let showTexture = false;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let probeSphere = null;

// ---------------------------------------------------------------------
// Three.js scene setup
// ---------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020617);
scene.fog = new THREE.FogExp2(0x020617, 0.0035);

const camera = new THREE.PerspectiveCamera(
  50,
  canvas.clientWidth / canvas.clientHeight,
  0.1,
  2000
);
camera.position.set(40, 40, 40);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
resizeRendererToDisplaySize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// Lighting
scene.add(new THREE.AmbientLight(0x4a6580, 0.5));

const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(50, 80, 30);
scene.add(sun);

const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.4);
fillLight.position.set(-40, 30, -20);
scene.add(fillLight);

// Grid helper for spatial reference
const gridHelper = new THREE.GridHelper(200, 40, 0x1e293b, 0x1e293b);
gridHelper.position.y = -0.1;
scene.add(gridHelper);

// Starfield background
addStars();

function addStars() {
  const starGeo = new THREE.BufferGeometry();
  const starCount = 800;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 600;
    positions[i * 3 + 1] = Math.random() * 300 + 50;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 600;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0x64748b,
    size: 0.8,
    transparent: true,
    opacity: 0.6,
  });
  scene.add(new THREE.Points(starGeo, starMat));
}

animate();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener("resize", resizeRendererToDisplaySize);

function resizeRendererToDisplaySize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------
// Upload UI wiring
// ---------------------------------------------------------------------
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-active");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-active");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-active");
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

// ---------------------------------------------------------------------
// File handling -> data.js -> mesh building
// ---------------------------------------------------------------------
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
  setProgress(0, "Starting…");

  // Load image in parallel for texture (non-blocking — if it fails, terrain
  // still renders with vertex colors alone)
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
  renderDataSummary(data);
  renderLegend(data);
  renderTerrain(data);
  showControls();
  hideEmptyState();
}

function hideEmptyState() {
  const el = document.getElementById("emptyState");
  if (el) el.classList.add("hidden");
}

function renderTerrain(data) {
  // Remove old terrain
  if (terrainMesh) {
    scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh.material.dispose();
  }
  if (wireOverlay) {
    scene.remove(wireOverlay);
    wireOverlay.geometry.dispose();
    wireOverlay.material.dispose();
  }
  if (probeSphere) {
    scene.remove(probeSphere);
    probeSphere.geometry.dispose();
    probeSphere.material.dispose();
    probeSphere = null;
  }

  // Determine height scale: normalize so terrain fits nicely in view
  const range = data.max_elevation - data.min_elevation || 1;
  const heightScale = Math.max(data.width, data.height) / (range * 3);

  const tex = showTexture ? textureImage : null;
  terrainMesh = buildTerrainMesh(data, tex, { heightScale, wireframe: false });
  scene.add(terrainMesh);

  if (showWireframe) {
    wireOverlay = buildWireframeOverlay(data, heightScale);
    scene.add(wireOverlay);
  }

  // Auto-frame camera to terrain
  frameCameraToMesh(terrainMesh, data);
}

function frameCameraToMesh(mesh, data) {
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 1.8;

  camera.position.set(
    center.x + dist * 0.7,
    center.y + dist * 0.8,
    center.z + dist * 0.7
  );
  controls.target.copy(center);
  controls.minDistance = maxDim * 0.3;
  controls.maxDistance = maxDim * 5;
  controls.update();
}

// ---------------------------------------------------------------------
// Click-to-probe raycasting
// ---------------------------------------------------------------------
canvas.addEventListener("click", (e) => {
  if (!terrainMesh || !currentData) return;

  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  const result = probeTerrain(raycaster, camera, mouse, terrainMesh, currentData);
  if (result) {
    renderProbeReadout(result, currentData);
    showProbeMarker(result.point, result.elevation, currentData);
  }
});

function renderProbeReadout(result, data) {
  const range = data.max_elevation - data.min_elevation || 1;
  const normalized = ((result.elevation - data.min_elevation) / range * 100).toFixed(1);
  const unit = data.path === "B" ? "m" : "";
  const pathLabel = data.path === "B" ? "absolute elevation" : "relative estimate";

  probeReadout.innerHTML = `
    <div class="probe-active">
      <div class="probe-value" style="color: ${elevationToColor((result.elevation - data.min_elevation) / range).getStyle()}">
        ${result.elevation.toFixed(2)} ${unit}
      </div>
      <div class="probe-meta">
        <span>Grid: (${result.x}, ${result.y})</span>
        <span>Percentile: ${normalized}%</span>
        <span>${pathLabel}</span>
      </div>
    </div>
  `;
}

function showProbeMarker(point, elevation, data) {
  if (probeSphere) {
    scene.remove(probeSphere);
    probeSphere.geometry.dispose();
    probeSphere.material.dispose();
  }

  const range = data.max_elevation - data.min_elevation || 1;
  const normalized = (elevation - data.min_elevation) / range;
  const color = elevationToColor(normalized);

  probeSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 16, 16),
    new THREE.MeshBasicMaterial({ color: color })
  );
  probeSphere.position.copy(point);
  probeSphere.position.y += 0.5;
  scene.add(probeSphere);

  // Pulse ring
  const ringGeo = new THREE.RingGeometry(1.2, 1.5, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: color,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.6,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(point);
  ring.position.y += 0.1;
  probeSphere.add(ring);

  // Animate the ring
  const startTime = performance.now();
  function pulse() {
    if (!probeSphere) return;
    const elapsed = (performance.now() - startTime) / 1000;
    const scale = 1 + Math.sin(elapsed * 3) * 0.3;
    ring.scale.setScalar(scale);
    ring.material.opacity = 0.6 - Math.sin(elapsed * 3) * 0.2;
    if (probeSphere) requestAnimationFrame(pulse);
  }
  pulse();
}

// ---------------------------------------------------------------------
// Legend rendering
// ---------------------------------------------------------------------
function renderLegend(data) {
  const unit = data.path === "B" ? "m" : "";
  legendMin.textContent = `${data.min_elevation.toFixed(1)} ${unit}`;
  legendMax.textContent = `${data.max_elevation.toFixed(1)} ${unit}`;

  // Build gradient CSS from elevationToColor
  const steps = 20;
  const stops = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const c = elevationToColor(t);
    stops.push(`${c.getStyle()} ${(t * 100).toFixed(0)}%`);
  }
  legendBar.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
}

// ---------------------------------------------------------------------
// UI Controls
// ---------------------------------------------------------------------
function showControls() {
  document.querySelectorAll(".terrain-control").forEach((el) => {
    el.classList.remove("hidden");
    el.classList.add("fade-in");
  });
}

toggleWireframeBtn?.addEventListener("click", () => {
  showWireframe = !showWireframe;
  toggleWireframeBtn.classList.toggle("active", showWireframe);
  if (currentData) renderTerrain(currentData);
});

toggleTextureBtn?.addEventListener("click", () => {
  showTexture = !showTexture;
  toggleTextureBtn.classList.toggle("active", showTexture);
  if (currentData) renderTerrain(currentData);
});

resetViewBtn?.addEventListener("click", () => {
  if (terrainMesh && currentData) {
    frameCameraToMesh(terrainMesh, currentData);
  }
});

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function renderDataSummary(data) {
  const pathLabel =
    data.path === "B"
      ? "Path B — absolute elevation (metres)"
      : "Path A — relative estimate (unitless)";

  dataSummary.innerHTML = `
    <div class="summary-row"><span class="summary-label">Grid</span><span class="summary-value">${data.width} × ${data.height}</span></div>
    <div class="summary-row"><span class="summary-label">Points</span><span class="summary-value">${(data.width * data.height).toLocaleString()}</span></div>
    <div class="summary-row"><span class="summary-label">Min</span><span class="summary-value">${data.min_elevation.toFixed(2)}</span></div>
    <div class="summary-row"><span class="summary-label">Max</span><span class="summary-value">${data.max_elevation.toFixed(2)}</span></div>
    <div class="summary-row"><span class="summary-label">Source</span><span class="summary-value">${data.path === "B" ? "Path B" : "Path A"}</span></div>
  `;
}

function setProgress(percent, label) {
  uploadProgressBar.style.width = `${percent}%`;
  uploadProgressLabel.textContent = label;
  if (percent >= 100) {
    setTimeout(() => uploadProgress.classList.add("hidden"), 600);
  }
}

function setStatus(state) {
  statusBadge.className = `status-badge ${state}`;
  statusBadge.textContent = state.toUpperCase();
}
