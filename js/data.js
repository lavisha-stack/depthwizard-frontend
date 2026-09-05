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

// Needed when the backend is exposed via an ngrok free-tier tunnel: ngrok
// otherwise serves an HTML "you're about to visit..." interstitial page to
// any request that looks like it came from a browser, which breaks every
// fetch() call below (it silently gets HTML back instead of JSON). This
// header is harmless and ignored by a normal (non-ngrok) backend.
const EXTRA_FETCH_HEADERS = { "ngrok-skip-browser-warning": "true" };

let pendingBackendTexture = null;

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
  const resultsResponse = await fetch(`${backendBaseUrl}/api/results/${encodeURIComponent(jobId)}`, {
    headers: EXTRA_FETCH_HEADERS,
  });
  const results = await readJsonResponse(resultsResponse);
  if (!resultsResponse.ok) throw new Error(formatApiError(results, resultsResponse.status));
  if (!results.heightmap_url) throw new Error("The backend completed the job but did not return a heightmap URL.");

  const heightmapResponse = await fetch(resolveBackendUrl(results.heightmap_url), {
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
    pipeline:
