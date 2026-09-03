/**
 * data.js
 * ---------------------------------------------------------------------
 * This is the ONLY file that should know where elevation data comes
 * from. Every other module just calls `getElevationData(file)` and
 * gets back a JSON object shaped like the contract below — it doesn't
 * know or care whether that came from a mock file or a real backend.
 *
 * WHEN TEAM 1'S BACKEND IS READY:
 * Replace the body of `getElevationData` with a real fetch() call
 * (see the commented-out example at the bottom of this file). Nothing
 * in main.js or mesh.js should need to change.
 *
 * EXPECTED JSON SHAPE (the proposed Team1 <-> Team2 contract):
 * {
 *   "width": number,          // grid width in points
 *   "height": number,         // grid height in points
 *   "elevation": number[],    // flat array, length === width * height,
 *                             // row-major order: elevation[y * width + x]
 *   "min_elevation": number,  // for normalizing / color-mapping
 *   "max_elevation": number,
 *   "path": "A" | "B"         // "A" = relative (Path A), "B" = absolute metric (Path B)
 * }
 * ---------------------------------------------------------------------
 */

const MOCK_DATA_URL = "./data/mock-elevation.json";

/**
 * Simulates the upload + processing round trip using local mock data.
 * Calls onProgress(percent, label) periodically so the UI can show a
 * progress bar, the same way it would during a real upload/fetch.
 *
 * @param {File} file - the file the user selected/dropped (currently
 *   unused by the mock, since we're not actually sending it anywhere —
 *   but the real implementation will need it, so it's part of the
 *   function signature from day one)
 * @param {(percent: number, label: string) => void} onProgress
 * @returns {Promise<object>} elevation data JSON, shaped as above
 */
export async function getElevationData(file, onProgress = () => {}) {
  onProgress(10, "Reading file…");
  await wait(300);

  onProgress(40, "Sending to processing pipeline… (mocked)");
  await wait(500);

  onProgress(75, "Fetching mock elevation grid…");
  const response = await fetch(MOCK_DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load mock data: ${response.status}`);
  }
  const json = await response.json();

  onProgress(100, "Done");
  await wait(150);

  return json;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------------------------------------------
 * REAL IMPLEMENTATION — uncomment and adapt once Team 1's endpoint exists.
 * Everything calling getElevationData() elsewhere in the app should not
 * need to change at all.
 * ---------------------------------------------------------------------
 *
 * const BACKEND_UPLOAD_URL = "https://<team1-backend-domain>/upload";
 *
 * export async function getElevationData(file, onProgress = () => {}) {
 *   const formData = new FormData();
 *   formData.append("file", file);
 *
 *   const response = await fetch(BACKEND_UPLOAD_URL, {
 *     method: "POST",
 *     body: formData,
 *     // NOTE: if frontend and backend are on different domains,
 *     // Team 1's FastAPI server needs CORS configured to allow
 *     // requests from this frontend's deployed domain.
 *   });
 *
 *   if (!response.ok) {
 *     throw new Error(`Upload failed: ${response.status}`);
 *   }
 *
 *   onProgress(100, "Done");
 *   return await response.json();
 * }
 */
