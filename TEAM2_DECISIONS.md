# Team 2 (Frontend) — Technical Decisions

This documents the decisions made for the Team 2 (UI / interactive 3D
environment) portion of **DepthWizard (SIH26175, ISRO)**. Written so Team 1
(backend/ML) — or anyone else — can understand the frontend's assumptions
without reading through the code.

**Status:** early skeleton. Upload UI, mock data pipeline, and a basic
Three.js scene are working end-to-end. Terrain mesh generation, texturing,
and click-to-probe are not built yet.

---

## Stack

- **Plain HTML / CSS / JS** — no framework, no build step. Chosen over
  React/Vite for hackathon speed: no compile step to fight, easy for
  anyone to open a file and understand what's running.
- **Tailwind CSS via CDN** — utility-class styling, zero configuration.
- **Three.js via ES module import map** — modern `import` syntax (matches
  current Three.js docs/examples) without needing a bundler.

## Project structure

```
index.html          — page layout, Tailwind + import map setup
css/style.css        — the few things Tailwind utilities don't cover
js/data.js           — SINGLE source of truth for "where elevation data
                       comes from". Currently backed by mock JSON.
                       Swap this file's internals for a real fetch()
                       once Team 1's endpoint exists — nothing else
                       should need to change.
js/main.js           — upload UI wiring + Three.js scene setup
data/mock-elevation.json — sample procedural elevation grid for local dev
```

## Proposed Team 1 <-> Team 2 API contract

This is a **proposal**, not yet confirmed by Team 1. Flagging here so it's
visible and can be corrected.

**Request:** frontend POSTs the uploaded image file (multipart/form-data)
to a Team-1-owned upload endpoint.

**Response (JSON):**

```json
{
  "width": 48,
  "height": 48,
  "elevation": [12.4, 12.6, 13.1, "... flat array, length = width * height"],
  "min_elevation": -28.84,
  "max_elevation": 31.26,
  "path": "A"
}
```

- `elevation` is a **flat 1D array**, row-major order:
  `elevation[y * width + x]` gives the value at grid position (x, y).
  (Not nested arrays — flat matches how Three.js `BufferGeometry` wants
  vertex data anyway, and is lighter over the wire.)
- `path`: `"A"` = Path A / relative depth estimate (unitless), `"B"` =
  Path B / absolute elevation (metres), so the frontend can label the
  HUD honestly instead of presenting both with equal confidence.
- `min_elevation` / `max_elevation` are provided by the backend (not
  recomputed client-side) so both sides agree on the same normalization
  range.

**Open questions for Team 1** (not yet answered):
- What resolution will `width`/`height` actually be? Full image
  resolution or downsampled? This affects whether JSON stays a
  practical transport format at scale.
- Confirm this JSON shape works for your output, or propose changes —
  better to agree now than reconcile after both sides have built
  against different assumptions.

## Deployment

- Frontend repo: `github.com/lavisha-stack/depthwizard-frontend` (public)
- Deploying via Vercel, connected to this repo (auto-deploys on push)
- If frontend and backend end up on different domains: Team 1's FastAPI
  server will need CORS configured to allow requests from the deployed
  frontend domain, or upload requests will be blocked by the browser.

## Next steps (frontend side)

1. Build `mesh.js` — convert elevation JSON into an actual vertex-displaced
   `PlaneGeometry` (currently a placeholder wireframe cube stands in for
   this in the scene).
2. Texture the mesh with the originally uploaded image.
3. Click-to-probe: raycast from mouse click to mesh, read elevation at
   that point, display in the HUD.
4. Swap `data.js`'s mock fetch for a real call once Team 1's endpoint
   is live.
