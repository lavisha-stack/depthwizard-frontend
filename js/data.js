/**
 * data.js — SINGLE source of truth for elevation data.
 *
 * MOCK MODE: turns the uploaded image into a deterministic, image-driven
 * terrain grid. It follows the same JSON contract as Team 1's backend, so
 * the UI does not need to know whether the source is mock or real.
 *
 * REAL MODE: replace only getElevationData() with Team 1's POST request.
 */

const MOCK_GRID_MAX = 72;

export async function getElevationData(file, onProgress = () => {}) {
  onProgress(8, "Reading imagery…");
  await wait(300);

  onProgress(24, "Input analyzer · detecting image type…");
  await wait(350);

  onProgress(48, "Depth inference · estimating surface…");
  const image = await decodeImage(file);
  await wait(550);

  onProgress(70, "Elevation calibration · building grid…");
  const grid = image
    ? await elevationFromImage(image, file)
    : proceduralTerrain(file);
  await wait(400);

  onProgress(88, "Mesh preparation · packaging model…");
  await wait(300);

  const flat = grid.elevation;
  const min_elevation = Math.min(...flat);
  const max_elevation = Math.max(...flat);
  const extension = file.name.toLowerCase().split(".").pop();
  const path = ["tif", "tiff"].includes(extension) ? "B" : "A";

  onProgress(100, "Terrain model ready");
  await wait(180);

  return {
    width: grid.width,
    height: grid.height,
    elevation: flat,
    min_elevation,
    max_elevation,
    path,
    mock: true,
    source_name: file.name,
    pipeline: [
      "Imagery ingested",
      "Input classified",
      "Relative depth estimated",
      path === "B" ? "Elevation anchor simulated" : "Relative surface retained",
      "Terrain mesh prepared",
    ],
  };
}

/** Decode browser-supported imagery for the mock model. */
async function decodeImage(file) {
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

/**
 * Creates a terrain surface from the uploaded image's luminance.
 * This is intentionally a visualization stand-in, NOT a depth model.
 * The uploaded pixels influence the shape, while a small multi-scale
 * smooth field makes the result look like a continuous landscape.
 */
async function elevationFromImage(img, file) {
  const aspect = img.width / Math.max(img.height, 1);
  let width = Math.round(MOCK_GRID_MAX * Math.min(1.35, Math.max(.72, aspect)));
  let height = Math.round(width / Math.max(aspect, .25));
  width = Math.min(MOCK_GRID_MAX, Math.max(32, width));
  height = Math.min(MOCK_GRID_MAX, Math.max(32, height));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;

  const seed = hashString(`${file.name}:${file.size}:${file.lastModified}`);
  const elevation = new Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2];
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const coarse = terrainNoise(x / width, y / height, seed);
      const ridge = Math.pow(Math.max(0, 1 - Math.abs(luminance - .52) * 1.9), 1.5);
      elevation[y * width + x] = 20 + luminance * 42 + coarse * 34 + ridge * 18;
    }
  }

  const smoothed = smoothGrid(elevation, width, height);
  return { width, height, elevation: smoothed };
}

/** Fallback for formats the browser cannot decode (for example some TIFFs). */
function proceduralTerrain(file) {
  const width = 60;
  const height = 60;
  const seed = hashString(`${file.name}:${file.size}:${file.lastModified}`);
  const elevation = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / (width - 1), ny = y / (height - 1);
      const ridge = Math.max(0, 1 - Math.abs(nx * .95 + ny * .7 - .75) * 2.2);
      const basin = Math.max(0, 1 - Math.hypot(nx - .34, ny - .68) * 3.1);
      elevation[y * width + x] = 18 + terrainNoise(nx, ny, seed) * 46 + ridge * 35 + basin * 18;
    }
  }
  return { width, height, elevation: smoothGrid(elevation, width, height) };
}

function smoothGrid(values, width, height) {
  const out = new Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let total = 0, weight = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const xx = Math.min(width - 1, Math.max(0, x + ox));
          const yy = Math.min(height - 1, Math.max(0, y + oy));
          const w = ox === 0 && oy === 0 ? 4 : 1;
          total += values[yy * width + xx] * w;
          weight += w;
        }
      }
      out[y * width + x] = total / weight;
    }
  }
  return out;
}

function terrainNoise(x, y, seed) {
  const a = Math.sin((x * 17.3 + y * 31.7 + seed) * 2.13);
  const b = Math.sin((x * 43.1 - y * 19.2 + seed * .7) * 1.41);
  const c = Math.sin((x * 7.7 + y * 9.9 + seed * 1.3) * 4.2);
  return Math.max(0, Math.min(1, .5 + a * .22 + b * .18 + c * .1));
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 100000;
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------------------------------------------
 * REAL IMPLEMENTATION — replace ONLY getElevationData() once Team 1's
 * endpoint exists. Keep this JSON contract and the rest of the frontend
 * remains unchanged.
 *
 * const BACKEND_UPLOAD_URL = "https://<team1-backend-domain>/upload";
 *
 * export async function getElevationData(file, onProgress = () => {}) {
 *   const formData = new FormData();
 *   formData.append("file", file);
 *   const response = await fetch(BACKEND_UPLOAD_URL, {
 *     method: "POST",
 *     body: formData,
 *   });
 *   if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
 *   onProgress(100, "Terrain model ready");
 *   return await response.json();
 * }
 * --------------------------------------------------------------------- */
