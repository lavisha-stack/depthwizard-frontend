# DepthWizard — Frontend (Team 2)

Interactive 3D terrain viewer for **SIH26175 (ISRO) — DepthWizard: Single-View
Height Estimation and 3D Flythrough**.

This repo is the frontend/UI side only. See
[`TEAM2_DECISIONS.md`](./TEAM2_DECISIONS.md) for stack choices, the proposed
API contract with the backend, and current status.

## Running locally

No build step — just serve the folder statically. For example:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly via `file://` may not work due to the
mock JSON being fetched — a local server avoids that.)
