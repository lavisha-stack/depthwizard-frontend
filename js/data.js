/**
 * data.js — real DepthWizard backend integration (FIXED).
 *
 * Handles all API field name variations from the backend.
 * Ensures elevation range validation and proper geometry reconstruction.
 */

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_TIME_MS = 30 * 60 * 1000;

const backendBaseUrl = String(
  import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_BASE_URL || DEFAULT_BACKEND_URL,
).replace(/\/$/, "");

const EXTRA_FETCH_HEADERS = { "ngrok-skip-browser-warning": "true" };

// CRITICAL FIX: Handle all backend field name variations
function normalizeBackendResponse(results) {
  return {
    width: Number(results.width) || 0,
    height: Number(results.height) || 0,
    minimum_elevation: Number(results.minimum_elevation ?? results.min_elevation ?? results.elevation_min ?? 0),
    maximum_elevation: Number(results.maximum_elevation ?? results.max_elevation ?? results.elevation_max ?? 0),
    is_georeferenced: Boolean(results.georeferenced ?? results.is_georeferenced ?? false),
    is_calibrated: Boolean(results.calibrated ?? results.is_calibrated ?? results.is_absolute_elevation ?? false),
    elevation_units: String(results.elevation_units ?? results.units ?? "relative").toLowerCase(),
    source_name: String(results.source_name ?? results.filename ?? "image"),
    source_type: String(results.source_type ?? results.input_type ?? "unknown"),
    crs: results.crs ?? results.target?.crs ?? null,
    pixel_size_m: Number(results.pixel_size_m ?? results.pixel_resolution?.[0] ?? 1),
    ...results
  };
}

export async function getElevationData(file, onProgress = () => {}) {
  if (!(file instanceof File)) throw new Error("No valid image file was provided.");

  onProgress(5, "Uploading imagery…");
  const form = new FormData();
  form.append("image", file);

  let uploadResponse;
  try {
    uploadResponse = await fetch(`${backendBaseUrl}/api/process`, {
      method: "POST",
      body: form,
      headers: EXTRA_FETCH_HEADERS,
    });
  } catch (err) {
    console.error("Backend connection error:", err);
    throw new Error(
      `Could not connect to the DepthWizard backend at ${backendBaseUrl}. ` +
      "Make sure the backend is running and VITE_BACKEND_URL is configured correctly.",
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
  const resultsResponse = await fetch(`${backendBaseUrl}/api/results/${encodeURIComponent(jobId)}`, {
    headers: EXTRA_FETCH_HEADERS,
  });
  const results = await readJsonResponse(resultsResponse);
  if (!resultsResponse.ok) throw new Error(formatApiError(results, resultsResponse.status));
  
  // CRITICAL FIX: Normalize all field name variations
  const normalizedResults = normalizeBackendResponse(results);
  
  if (!normalizedResults.heightmap_url && !results.heightmap_url && !results.three_d_data_url) {
    throw new Error("The backend completed the job but did not return a heightmap URL.");
  }

  const heightmapUrl = normalizedResults.heightmap_url || results.heightmap_url || results.three_d_data_url;
  const heightmapResponse = await fetch(resolveBackendUrl(heightmapUrl), {
    headers: EXTRA_FETCH_HEADERS,
  });
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
    throw new Error(`Invalid terrain grid size: ${width} × ${height}. Expected at least 2×2.`);
  }
  if (!elevation || elevation.length !== width * height) {
    throw new Error(
      `Invalid elevation grid: expected ${width * height} values, ` +
      `got ${elevation?.length || 'null'}. Backend may have returned invalid heightmap format.`
    );
  }
  if (elevation.some(value => !Number.isFinite(value))) {
    throw new Error(
      "Elevation grid contains NaN or infinite values. " +
      "Person 1 or Person 3 may not have properly calibrated the depth map."
    );
  }

  let calculatedMin = Infinity;
  let calculatedMax = -Infinity;
  for (const value of elevation) {
    if (value < calculatedMin) calculatedMin = value;
    if (value > calculatedMax) calculatedMax = value;
  }

  // CRITICAL FIX: Use normalized field names for elevation range
  const min_elevation = finiteNumber(
    heightmap.elevation_min,
    heightmap.min_elevation,
    normalizedResults.minimum_elevation,
    calculatedMin
  );
  const max_elevation = finiteNumber(
    heightmap.elevation_max,
    heightmap.max_elevation,
    normalizedResults.maximum_elevation,
    calculatedMax
  );

  // CRITICAL FIX: Validate elevation range is sensible
  if (!Number.isFinite(min_elevation) || !Number.isFinite(max_elevation)) {
    throw new Error(
      `Elevation range is not finite: min=${min_elevation}, max=${max_elevation}. ` +
      "The heightmap may be corrupted or all values are identical."
    );
  }
  if (max_elevation <= min_elevation) {
    console.warn(
      `⚠️ WARNING: max_elevation (${max_elevation}) ≤ min_elevation (${min_elevation}). ` +
      "Terrain will be flat. This indicates Person 3's calibration may have failed."
    );
  }

  const georeferenced = normalizedResults.is_georeferenced;
  const calibrated = normalizedResults.is_calibrated || normalizedResults.elevation_units === "m";
  const absoluteElevation = calibrated || normalizeUnits(heightmap.units) === "m";
  const elevation_unit = absoluteElevation ? "m" : "relative";
  const path = georeferenced ? "B" : "A";

  const validation = buildValidation(results);

  onProgress(100, "Terrain model ready");
  const result = {
    width,
    height,
    elevation,
    min_elevation,
    max_elevation,
    path,
    mock: false,
    source_name: normalizedResults.source_name,
    source_type: normalizedResults.source_type,
    georeferenced,
    calibrated: absoluteElevation,
    elevation_unit,
    validation,
    crs: normalizedResults.crs,
    pixel_size_m: normalizedResults.pixel_size_m,
    output_url: results.dsm_download_url ?? null,
    depth_preview_url: resolveOptionalUrl(results.depth_preview_url),
    dsm_preview_url: resolveOptionalUrl(results.dsm_preview_url),
    heightmap_url: resolveOptionalUrl(results.heightmap_url || results.three_d_data_url),
    texture_url: resolveOptionalUrl(results.texture_url),
    dsm_download_url: resolveOptionalUrl(results.dsm_download_url),
    metadata_url: resolveOptionalUrl(results.metadata_url),
    pipeline: buildPipelineDescription({ georeferenced, calibrated: absoluteElevation, path, elevation_unit }),
  };

  console.log("✓ Elevation data loaded successfully:", result);
  return result;
}

/**
 * Load the correct judge-facing RGB image.
 *
 * PNG/JPEG can be decoded directly in the browser, preserving the exact upload.
 * TIFF cannot be relied on to decode in a normal browser, so the backend's
 * lossless rgb_texture.png conversion is used for TIFF inputs.
 */
export async function loadImageFile(file, backendTextureUrl = null) {
  if (!(file instanceof File)) return null;
  const extension = fileExtension(file.name);

  if (["tif", "tiff"].includes(extension)) {
    if (!backendTextureUrl) return null;
    return loadImageUrl(backendTextureUrl).catch(() => null);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageUrl(objectUrl);
    image.__depthwizardObjectUrl = objectUrl;
    return image;
  } catch (err) {
    console.warn("Could not load texture from file:", err);
    URL.revokeObjectURL(objectUrl);
    return null;
  }
}

async function waitForJob(jobId, onProgress) {
  const startedAt = Date.now();
  let lastLoggedProgress = 0;
  
  while (Date.now() - startedAt < MAX_POLL_TIME_MS) {
    const response = await fetch(`${backendBaseUrl}/api/status/${encodeURIComponent(jobId)}`, {
      headers: EXTRA_FETCH_HEADERS,
    });
    const status = await readJsonResponse(response);
    if (!response.ok) throw new Error(formatApiError(status, response.status));

    const progress = Number(status.progress);
    const boundedProgress = Number.isFinite(progress) ? Math.max(8, Math.min(95, progress)) : 8;
    
    // Only log on significant progress changes to reduce noise
    if (Math.abs(boundedProgress - lastLoggedProgress) >= 5) {
      console.log(`Job ${jobId} progress: ${boundedProgress}% - ${statusLabel(status)}`);
      lastLoggedProgress = boundedProgress;
    }
    
    onProgress(boundedProgress, statusLabel(status));

    if (status.status === "completed") return status;
    if (status.status === "failed" || status.status === "error") {
      throw new Error(
        status.message ||
        `Pipeline failed during ${status.stage || "processing"}. ` +
        `Check the backend logs for details.`
      );
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error("The terrain pipeline took too long to finish (> 30 minutes). Check the backend job status and try again.");
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
  } catch (err) {
    console.warn("Could not resolve backend URL:", value, err);
    return value;
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn("Response is not valid JSON:", text.slice(0, 200));
    return { detail: text };
  }
}

function formatApiError(body, statusCode) {
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(item => item?.msg || String(item)).join("; ");
  return `Backend request failed${statusCode ? ` (HTTP ${statusCode})` : ""}. Please check the backend logs.`;
}

function loadImageUrl(url) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error("No texture URL was provided."));
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      console.log("✓ Texture loaded:", url);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`The terrain texture could not be loaded from ${url}`));
    img.src = url;
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
