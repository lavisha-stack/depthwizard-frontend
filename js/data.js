/**
 * data.js — real DepthWizard backend integration.
 *
 * The browser no longer creates or estimates terrain locally. It uploads the
 * selected image to Team 1's FastAPI backend, polls the job, then loads the
 * backend-generated heightmap.json. The backend is the source of truth for
 * path selection, georeferencing, calibration, elevation units and metadata.
 *
 * Set VITE_BACKEND_URL in Vercel for the deployed API. Local development
 * defaults to http://127.0.0.1:8000.
 */

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_TIME_MS = 30 * 60 * 1000;

const backendBaseUrl = String(
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_BASE_URL || DEFAULT_BACKEND_URL,
).replace(/\/$/, "");

let pendingBackendTexture = null;

export async function getElevationData(file, onProgress = () => {}) {
  if (!(file instanceof File)) throw new Error("No valid image file was provided.");

  onProgress(5, "Uploading imagery…");
  const form = new FormData();
  form.append("image", file);

  let uploadResponse;
  try {
    uploadResponse = await fetch(`${backendBaseUrl}/api/process`, { method: "POST", body: form });
  } catch {
    throw new Error(
      `Could not connect to the DepthWizard backend at ${backendBaseUrl}. ` +
      "Make sure the backend is running and VITE_BACKEND_URL is configured.",
    );
  }

  const uploadBody = await readJsonResponse(uploadResponse);
  if (!uploadResponse.ok) throw new Error(formatApiError(uploadBody, uploadResponse.status));

  const jobId = uploadBody?.job_id;
  if (!jobId) throw new Error("The backend accepted the upload but did not return a job ID.");
  onProgress(8, "Image uploaded · job queued");

  const status = await waitForJob(jobId, onProgress);
  if (status.status !== "completed") {
    throw new Error(status.message || "The backend could not complete the terrain pipeline.");
  }

  onProgress(96, "Loading generated terrain…");
  const resultsResponse = await fetch(`${backendBaseUrl}/api/results/${encodeURIComponent(jobId)}`);
  const results = await readJsonResponse(resultsResponse);
  if (!resultsResponse.ok) throw new Error(formatApiError(results, resultsResponse.status));
  if (!results.heightmap_url) throw new Error("The backend completed the job but did not return a heightmap URL.");

  const heightmapResponse = await fetch(resolveBackendUrl(results.heightmap_url));
  const heightmap = await readJsonResponse(heightmapResponse);
  if (!heightmapResponse.ok) throw new Error(formatApiError(heightmap, heightmapResponse.status));

  const width = Number(heightmap.width);
  const height = Number(heightmap.height);
  const elevation = Array.isArray(heightmap.heights)
    ? heightmap.heights.map(Number)
    : Array.isArray(heightmap.elevation)
      ? heightmap.elevation.map(Number)
      : null;

  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error("The backend returned an invalid terrain grid size.");
  }
  if (!elevation || elevation.length !== width * height || elevation.some(value => !Number.isFinite(value))) {
    throw new Error("The backend returned an invalid elevation grid.");
  }

  const calculatedMin = Math.min(...elevation);
  const calculatedMax = Math.max(...elevation);
  const min_elevation = finiteNumber(heightmap.elevation_min, results.minimum_elevation, results.min_elevation, calculatedMin);
  const max_elevation = finiteNumber(heightmap.elevation_max, results.maximum_elevation, results.max_elevation, calculatedMax);

  const georeferenced = Boolean(results.georeferenced ?? results.is_georeferenced ?? false);
  const calibrated = Boolean(results.calibrated ?? results.is_absolute_elevation ?? false);
  const absoluteElevation = calibrated || normalizeUnits(heightmap.units) === "m" || normalizeUnits(results.elevation_units) === "m";
  const elevation_unit = absoluteElevation ? "m" : "relative";
  const path = georeferenced ? "B" : "A";

  const validation = buildValidation(results);

  if (pendingBackendTexture) {
    const waiter = pendingBackendTexture;
    pendingBackendTexture = null;
    if (results.texture_url) {
      loadImageUrl(resolveBackendUrl(results.texture_url))
        .then(waiter.resolve)
        .catch(() => waiter.resolve(null));
    } else {
      waiter.resolve(null);
    }
  }

  onProgress(100, "Terrain model ready");
  return {
    width,
    height,
    elevation,
    min_elevation,
    max_elevation,
    path,
    mock: false,
    source_name: results.source_name || results.filename || file.name,
    source_type: results.source_type || results.input_type || fileExtension(file.name).toUpperCase(),
    georeferenced,
    calibrated: absoluteElevation,
    elevation_unit,
    validation,
    crs: results.crs ?? results.target?.crs ?? null,
    pixel_size_m: results.pixel_size_m ?? extractPixelSize(results),
    output_url: results.dsm_download_url ?? null,
    depth_preview_url: resolveOptionalUrl(results.depth_preview_url),
    dsm_preview_url: resolveOptionalUrl(results.dsm_preview_url),
    heightmap_url: resolveOptionalUrl(results.heightmap_url),
    texture_url: resolveOptionalUrl(results.texture_url),
    dsm_download_url: resolveOptionalUrl(results.dsm_download_url),
    metadata_url: resolveOptionalUrl(results.metadata_url),
    pipeline: buildPipelineDescription({ georeferenced, calibrated: absoluteElevation, path, elevation_unit }),
  };
}

async function waitForJob(jobId, onProgress) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_POLL_TIME_MS) {
    const response = await fetch(`${backendBaseUrl}/api/status/${encodeURIComponent(jobId)}`);
    const status = await readJsonResponse(response);
    if (!response.ok) throw new Error(formatApiError(status, response.status));

    const progress = Number(status.progress);
    const boundedProgress = Number.isFinite(progress) ? Math.max(8, Math.min(95, progress)) : 8;
    onProgress(boundedProgress, statusLabel(status));

    if (status.status === "completed") return status;
    if (status.status === "failed" || status.status === "error") {
      throw new Error(status.message || `Pipeline failed during ${status.stage || "processing"}.`);
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error("The terrain pipeline took too long to finish. Check the backend job status and try again.");
}

function statusLabel(status) {
  const labels = {
    queued: "Job queued…",
    preprocessing: "Input analyzer · preprocessing imagery…",
    depth_estimation: "Depth inference · estimating relative surface…",
    calibration: "Elevation calibration · building DSM…",
    completed: "Terrain model ready",
    failed: "Pipeline failed",
    error: "Pipeline failed",
  };
  return status.message || labels[status.status] || "Processing terrain…";
}

function buildPipelineDescription({ georeferenced, calibrated, path, elevation_unit }) {
  if (calibrated && elevation_unit === "m") {
    return [
      "Imagery ingested by FastAPI",
      "Input analyzed",
      "Monocular depth estimated",
      "Geospatial calibration completed",
      "Absolute DSM converted to browser heightmap",
      "Three.js terrain ready",
    ];
  }
  if (georeferenced || path === "B") {
    return [
      "Imagery ingested by FastAPI",
      "Input analyzed as geospatial imagery",
      "Monocular depth estimated",
      "Relative surface retained",
      "Metric calibration not confirmed",
      "Three.js terrain ready",
    ];
  }
  return [
    "Imagery ingested by FastAPI",
    "Input classified",
    "Monocular depth estimated",
    "Relative surface retained",
    "Three.js terrain ready",
  ];
}

function buildValidation(results) {
  const sampleCount = firstFinite(results.sample_count, results.validation?.sample_count);
  const mae = firstFinite(results.mae_m, results.validation?.mae_m);
  const rmse = firstFinite(results.rmse_m, results.validation?.rmse_m);
  const correlation = firstFinite(results.correlation, results.validation?.correlation);
  if ([sampleCount, mae, rmse, correlation].every(value => value == null)) return null;
  return { sample_count: sampleCount ?? 0, mae_m: mae ?? null, rmse_m: rmse ?? null, correlation: correlation ?? null };
}

function extractPixelSize(results) {
  const candidate = results.pixel_resolution || results.target?.pixel_resolution;
  if (!Array.isArray(candidate)) return null;
  const values = candidate.map(Number).filter(Number.isFinite);
  return values.length ? Math.abs(values[0]) : null;
}

function normalizeUnits(value) {
  if (typeof value !== "string") return "relative";
  const normalized = value.trim().toLowerCase();
  return ["m", "metre", "metres", "meter", "meters"].includes(normalized) ? "m" : "relative";
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function firstFinite(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function fileExtension(name) {
  return String(name || "").toLowerCase().split(".").pop() || "image";
}

function resolveOptionalUrl(value) {
  return value ? resolveBackendUrl(value) : null;
}

function resolveBackendUrl(value) {
  if (!value) return null;
  try {
    return new URL(value, `${backendBaseUrl}/`).toString();
  } catch {
    return value;
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

function formatApiError(body, statusCode) {
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(item => item?.msg || String(item)).join("; ");
  return `Backend request failed${statusCode ? ` (HTTP ${statusCode})` : ""}.`;
}

function loadImageUrl(url) {
  return new Promise((resolve, reject) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The backend terrain texture could not be loaded."));
    img.src = url;
  });
}

export function loadImageFile(file) {
  if (["tif", "tiff"].includes(fileExtension(file.name))) {
    return new Promise(resolve => {
      pendingBackendTexture = { resolve };
    });
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
