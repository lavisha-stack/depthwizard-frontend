/**
 * data.js — SINGLE source of truth for "where elevation data comes from".
 * Every other module calls `getElevationData(file)` and gets back a
 * JSON object shaped like the Team1↔Team2 contract — it doesn't know
 * or care whether that came from a mock file or a real backend.
 *
 * EXPECTED JSON SHAPE:
 * {
 *   "width": number,
 *   "height": number,
 *   "elevation": number[],    // flat, row-major: elevation[y * width + x]
 *   "min_elevation": number,
 *   "max_elevation": number,
 *   "path": "A" | "B"
 * }
 *
 * WHEN TEAM 1'S BACKEND IS READY:
 * Replace the body of `getElevationData` with a real fetch() call
 * (see the commented-out example at the bottom). Nothing else needs to change.
 */

const MOCK_DATA_URL = "./data/mock-elevation.json";

/**
 * Simulates the upload + processing round trip using local mock data.
 * Calls onProgress(percent, label) periodically so the UI can show a
 * progress bar, the same way it would during a real upload/fetch.
 *
 * @param {File} file - the file the user selected/dropped
 * @param {(percent: number, label: string) => void} onProgress
 * @returns {Promise<object>} elevation data JSON
 */
export async function getElevationData(file, onProgress = () => {}) {
  onProgress(10, "Reading file…");
  await wait(300);

  onProgress(40, "Sending to processing pipeline… (mocked)");
  await wait(500);

  onProgress(75, "Fetching elevation grid…");
  const response = await fetch(MOCK_DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load mock data: ${response.status}`);
  }
  const json = await response.json();

  onProgress(100, "Done");
  await wait(150);

  return json;
}

/**
 * Loads an image File into an HTMLImageElement for use as a texture.
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
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
 * REAL IMPLEMENTATION — uncomment and adapt once Team 1's endpoint exists.
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
 *   onProgress(100, "Done");
 *   return await response.json();
 * }
 */
