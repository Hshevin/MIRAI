# Agent Guide

## Non-negotiable rules

- Use `uv` for every Python environment and dependency operation (`uv sync`, `uv add`, `uv run`). Do not use ad-hoc `pip` commands.
- Privacy fails closed: pixels are clear only when they confidently belong to the selected primary person. Unknown or conflicting pixels are anonymized.
- Never commit uploaded media, rendered media, model weights, masks, embeddings, caches, secrets, `.venv`, or `var/`.
- Preserve unrelated user changes. Commit only coherent, verified milestone work. Never push, rebase, amend, tag, or modify a remote unless requested.
- Update this file in the same commit as architecture, framework, API, schema, storage-format, command, or privacy-invariant changes.

## Product

The application analyzes a video, discovers and tracks people, lets a user select and correct one primary identity, then exports a video in which only approved primary-person pixels are clear. Audio is preserved but is not anonymized.

## Architecture

```text
React UI -> FastAPI API -> SQLite + project artifact store
                         -> single GPU worker
                            analysis: probe/cuts/detect/track/Re-ID/cluster
                            render: SAM masks/safety/anonymize/encode/mux
```

The local MVP uses a two-pass pipeline. Pass 1 caches media timestamps, detections, tracklets, embeddings, identity groups, thumbnails, and statistics. After selection and timeline corrections, Pass 2 composites approved person masks over a mosaic-and-blurred frame and publishes only validated media. The current renderer uses conservative cached YOLO polygons; SAM 2.1 temporal refinement remains the next vision milestone.

## Framework and model decisions

- Python 3.12, FastAPI, Pydantic, SQLAlchemy, SQLite, PyAV, OpenCV, NumPy, FFmpeg/FFprobe.
- React + TypeScript + Vite frontend.
- YOLO26l-seg detection/coarse masks, BoxMOT BoT-SORT, OSNet x1.0 MSMT17 Re-ID, SAM 2.1 Hiera Base+ final masks.
- Ultralytics and BoxMOT are AGPL dependencies; this is accepted for the local MVP and must be reviewed before commercial distribution or hosted deployment.
- One dedicated worker leases SQLite jobs; GPU concurrency is one.

## Repository map

- `src/figure_detection/api`: HTTP routes and schemas.
- `src/figure_detection/domain`: enums, entities, and privacy policies.
- `src/figure_detection/media`: FFprobe, PyAV, encoding, and mux validation.
- `src/figure_detection/vision`: detector, tracker, Re-ID, and SAM adapters.
- `src/figure_detection/pipeline`: analysis, identity, preview, and render orchestration.
- `src/figure_detection/storage`: database and artifact persistence.
- `src/figure_detection/worker`: job leasing, progress, cancellation, and checkpoints.
- `web`: browser UI.
- `configs`: versioned model/tracker/privacy/export defaults.
- `tests`: unit, integration, CV-quality, and end-to-end tests.
- `var`: runtime database, uploads, proxies, caches, previews, and outputs; never commit.

## Commands

```bash
uv sync --extra dev
uv run figure-detection-api
uv run figure-detection-worker
uv run pytest
uv run ruff check .
uv run ruff format --check .
cd web && npm install && npm run dev
```

FFmpeg and FFprobe 6.1+ must be on `PATH`. GPU jobs require a CUDA-capable NVIDIA GPU; the API health endpoint reports readiness.

## Data and API invariants

- Store exact integer PTS and time-base numerator/denominator. Never derive VFR identity from nominal FPS alone.
- Tracker state never crosses a scene cut.
- Temporally overlapping tracklets cannot belong to the same global identity automatically.
- Ambiguous identity memberships are excluded until the user includes them.
- Selection and correction data is immutable and revisioned; jobs bind to one revision and settings snapshot.
- Artifacts become downloadable only after validation and atomic publication.
- Expert mask expansion must be explicitly acknowledged and recorded.
- Vision packages import lazily. The base/dev environment must support API and algorithm tests without CUDA or model weights; GPU workers use `uv sync --extra vision`.

## Git policy

Commit automatically after a coherent milestone passes its relevant tests. Use descriptive conventional messages, stage only milestone-owned files, and include this guide when architecture changes. Report commit hashes in the handoff.

## Current status

Milestones 0–2 and the functional render slice are complete: revisioned selection, identity overrides, normalized point/box prompts, privacy settings, gallery/timeline UI, conservative compositing, PTS-aware H.264 rendering, audio mux, validation, and artifact download are implemented. SAM 2.1 temporal mask refinement and production GPU acceptance remain outstanding.

## Architecture decisions

- 2026-08-18: Local single-user deployment; SQLite-backed dedicated worker instead of Redis/Celery.
- 2026-08-18: Two-pass analysis/render workflow with conservative exclusion and timeline corrections.
- 2026-08-18: Exact timestamp preservation via PyAV plus FFmpeg final mux.
- 2026-08-18: Vision adapters are optional/lazy so API and identity-policy tests run on non-GPU machines.
- 2026-08-18: Selection edits form an immutable parent chain; render jobs bind to a leaf revision.
- 2026-08-18: Coarse instance polygons provide a privacy-safe functional fallback until SAM 2.1 refinement is integrated.
