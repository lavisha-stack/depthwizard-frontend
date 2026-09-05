/**
 * data.js — single source of truth for elevation data.
 *
 * DEMO MODE: creates an image-driven elevation surface so Team 2 can build
 * and test the Three.js viewer before Team 1's backend is available.
 *
 * REAL MODE: Team 1 should replace only getElevationData() with the backend
 * request. Keep the returned JSON contract below.
 *
 * Important: a .tif/.tiff extension does NOT prove that an image is a
 * GeoTIFF or that it contains elevation. The backend must inspect geospatial
 * metadata and reference-elevation availability before selecting Path B.
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

  onProgress(70, "Building demo elevation grid…");
  const grid = image
    ? await elevationFromImage(image, file)
    : proceduralTerrain(file);
  await wait(400);

  onProgress(88, "Mesh preparation · packaging model…");
  await wait(300);

  const flat = grid.elevation;
  const min_elevation = Math.min(...flat);
  const max_elevation = Math.max(...flat);

  // DEMO ONLY: TIFF is treated as a Path B candidate so the second pipeline
  // can be exercised, but it is explicitly NOT called georeferenced or
  // calibrated. The real backend must make that decision from metadata/data.
  const extension = file.name.toLowerCase().split(".").pop();
  const isTiffCandidate = ["tif", "tiff"].includes(extension);
  const path = isTiffCandidate ? "B" : "A";

  onProgress(100, "Terrain model ready");
  await wait(180);

  return {
    width: grid.width,
    height: grid.height,
    elevation: flat,
    min_elevation,
    max_elevation,
    path,

    // Explicit provenance/state fields for the frontend contract.
    mock: true,
    source_name: file.name,
    source_type: extension.toUpperCase(),
    georeferenced: false,
    calibrated: false,
    elevation_unit: "relative",
    validation: null,

    pipeline: [
      "Imagery ingested",
      "Input classified",
      "Relative depth estimated",
      path === "B"
        ? "TIFF candidate detected — georeference pending"
        : "Relative surface retained",
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
 * Creates a smooth visualization surface from the uploaded image's
 * luminance. This is intentionally a visualization stand-in, NOT a depth
 * model and NOT a metric elevation estimator.
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
 * REAL IMPLEMENTATION — Team 1 should replace ONLY getElevationData()
 * once the endpoint exists. Keep this JSON contract.
 *
 * Expected real response shape:
 * {
 *   width: number,
 *   height: number,
 *   elevation: number[],
 *   min_elevation: number,
 *   max_elevation: number,
 *   path: "A" | "B",
 *   georeferenced: boolean,
 *   calibrated: boolean,
 *   elevation_unit: "relative" | "m",
 *   validation: {
 *     sample_count: number,
 *     mae_m: number,
 *     rmse_m: number,
 *     correlation: number
 *   } | null,
 *   source_name?: string,
 *   source_type?: string,
 *   crs?: string | null,
 *   pixel_size_m?: number | null,
 *   output_url?: string | null
 * }
 *
 * The frontend must NOT infer Path B from the .tif extension. The backend
 * decides Path B only after checking actual geospatial metadata and whether
 * a valid elevation reference/calibration path is available.
 * --------------------------------------------------------------------- */
