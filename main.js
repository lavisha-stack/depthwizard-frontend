/**
 * main.js
 * ---------------------------------------------------------------------
 * Entry point. This file wires together:
 *   1. Upload UI (drag/drop + click-to-browse) — WORKING
 *   2. Data fetching (via data.js)              — WORKING (mocked)
 *   3. Three.js scene setup                     — WORKING (skeleton only)
 *   4. Terrain mesh building from elevation data — TODO (not built yet)
 *   5. Click-to-probe raycasting                 — TODO (not built yet)
 *
 * This is intentionally a SKELETON: the plumbing (upload -> data ->
 * scene) is proven end-to-end, but the actual terrain mesh is a
 * placeholder cube for now. Next steps are building out mesh.js to
 * turn elevation JSON into real vertex-displaced geometry.
 * ---------------------------------------------------------------------
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getElevationData } from "./data.js";

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

// ---------------------------------------------------------------------
// Three.js scene setup (skeleton — placeholder cube stands in for the
// terrain mesh until mesh.js is built)
// ---------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020617); // matches bg-slate-950

const camera = new THREE.PerspectiveCamera(
  50,
  canvas.clientWidth / canvas.clientHeight,
  0.1,
  1000
);
camera.position.set(40, 40, 40);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
resizeRendererToDisplaySize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Basic lighting — will matter once real terrain geometry + texture exist
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(50, 80, 30);
scene.add(sun);

// TODO: replace this placeholder with the real terrain mesh (see mesh.js,
// to be built next) once we're ready to turn elevation JSON into geometry.
const placeholder = new THREE.Mesh(
  new THREE.BoxGeometry(10, 10, 10),
  new THREE.MeshStandardMaterial({ color: 0x38bdf8, wireframe: true })
);
scene.add(placeholder);

animate();

function animate() {
  requestAnimationFrame(animate);
  placeholder.rotation.y += 0.003; // just proves the render loop is alive
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

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("border-sky-500");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("border-sky-500");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("border-sky-500");
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

// ---------------------------------------------------------------------
// File handling -> data.js -> (eventually) mesh building
// ---------------------------------------------------------------------
async function handleFile(file) {
  setStatus("processing");
  uploadProgress.classList.remove("hidden");
  setProgress(0, "Starting…");

  try {
    const elevationData = await getElevationData(file, setProgress);
    onElevationDataReady(elevationData);
    setStatus("ready");
  } catch (err) {
    console.error(err);
    setStatus("error");
    uploadProgressLabel.textContent = "Something went wrong — check console.";
  }
}

function onElevationDataReady(data) {
  renderDataSummary(data);

  // TODO: this is where mesh.js will take over —
  //   const terrainMesh = buildTerrainMesh(data);
  //   scene.remove(placeholder);
  //   scene.add(terrainMesh);
  //
  // For now we just confirm the data arrived correctly.
  console.log("Elevation data ready:", data);
}

function renderDataSummary(data) {
  const pathLabel =
    data.path === "B"
      ? "Path B — absolute elevation (metres)"
      : "Path A — relative estimate (unitless)";

  dataSummary.innerHTML = `
    <p><span class="text-slate-500">Grid:</span> ${data.width} × ${data.height}</p>
    <p><span class="text-slate-500">Range:</span> ${data.min_elevation} to ${data.max_elevation}</p>
    <p><span class="text-slate-500">Source:</span> ${pathLabel}</p>
  `;
}

function setProgress(percent, label) {
  uploadProgressBar.style.width = `${percent}%`;
  uploadProgressLabel.textContent = label;
  if (percent >= 100) {
    setTimeout(() => uploadProgress.classList.add("hidden"), 400);
  }
}

function setStatus(state) {
  const styles = {
    idle: "bg-slate-800 text-slate-300",
    processing: "bg-amber-900/50 text-amber-300",
    ready: "bg-emerald-900/50 text-emerald-300",
    error: "bg-red-900/50 text-red-300",
  };
  statusBadge.className = `text-xs px-3 py-1 rounded-full ${styles[state]}`;
  statusBadge.textContent = state;
}

// ---------------------------------------------------------------------
// TODO (next steps, in rough order):
//   1. mesh.js — turn elevation JSON into a real PlaneGeometry with
//      vertex displacement (this is the actual "terrain mesh" step).
//   2. Texture the mesh with the originally uploaded image.
//   3. Raycasting on click -> read elevation at that vertex -> update
//      probeReadout with real values instead of the placeholder text.
//   4. Swap data.js's mock fetch for a real call to Team 1's endpoint.
// ---------------------------------------------------------------------
