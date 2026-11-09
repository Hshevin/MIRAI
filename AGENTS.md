# Agent Guide

## Non-negotiable rules

- Use `uv` for every Python environment and dependency operation (`uv sync`, `uv add`, `uv run`). Do not use ad-hoc `pip` commands.
- Privacy fails closed: pixels are clear only when they confidently belong to the selected primary person. Unknown or conflicting pixels are anonymized.
- Never commit uploaded media, rendered media, model weights, masks, embeddings, caches, secrets, `.venv`, or `var/`.
- Preserve unrelated user changes. Commit only coherent, verified milestone work. Never push, rebase, amend, tag, or modify a remote unless requested.
- Update this file in the same commit as architecture, framework, API, schema, storage-format, command, or privacy-invariant changes.

## Product

The project is named MIRAI (Masked Identity Rendering And Isolation). The Python package, CLI entry points, and environment variable prefix remain `figure_detection` / `figure-detection` / `FIGURE_DETECTION_*`.

The application analyzes a video, discovers and tracks people, lets a user select and correct one primary identity, then exports a video in which only approved primary-person pixels are clear. Audio is preserved but is not anonymized.

## Architecture

```text
React UI -> FastAPI API -> SQLite + project artifact store
                         -> single GPU worker
                            analysis: probe/cuts/detect/track/Re-ID/cluster
                            render: SAM masks/safety/anonymize/encode/mux
```

The local MVP uses a two-pass pipeline. Pass 1 caches media timestamps, detections, tracklets, embeddings, identity groups, thumbnails, and statistics. After selection and timeline corrections, Pass 2 refines approved instances with SAM 2.1 when configured, falls back conservatively to cached YOLO polygons, composites over a mosaic-and-blurred frame, and publishes only validated media. Cross-frame SAM memory and flow stabilization remain a quality milestone.

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
- `web`: browser UI. `web/src/i18n.tsx` holds typed zh/en dictionaries (every key must exist in both); `web/src/styles.css` defines the design tokens.
- `configs`: versioned model/tracker/privacy/export defaults.
- `tests`: unit, integration, CV-quality, and end-to-end tests.
- `docs`: design notes and roadmaps; `docs/ux-roadmap.md` holds the prioritized interaction/feature plan.
- `var`: runtime database, uploads, proxies, caches, previews, and outputs; never commit.
- `var/logs`: bounded structured process logs and rotated backups; never commit.

## Commands

```bash
./scripts/launch.sh                    # Linux/macOS: launch all services
.\scripts\launch.ps1                   # Windows PowerShell: launch all services
uv sync --extra dev
SAM2_BUILD_CUDA=0 uv sync --extra dev --extra vision
uv run figure-detection-api
uv run figure-detection-worker
uv run pytest
uv run ruff check .
uv run ruff format --check .
cd web && npm install && npm run dev
cd web && npm test && npm run format:check   # Prettier (web/.prettierrc.json); npm run format fixes
```

FFmpeg and FFprobe 6.1+ must be on `PATH`. GPU jobs require a CUDA-capable NVIDIA GPU; the API health endpoint reports readiness.

## Data and API invariants

- Project deletion is two-phase: tombstone and cancel jobs first; purge rows and files only after running jobs stop (a running job whose lease has expired counts as stopped). Purge explicitly deletes dependent rows in order without relying on foreign-key cascades. DELETED videos and their resources are invisible to API callers.
- Store exact integer PTS and time-base numerator/denominator. Never derive VFR identity from nominal FPS alone.
- Tracker state never crosses a scene cut.
- Temporally overlapping tracklets cannot belong to the same global identity automatically.
- Ambiguous identity memberships are excluded until the user includes them.
- Selection and correction data is immutable and revisioned; jobs bind to one revision and settings snapshot.
- Artifacts become downloadable only after validation and atomic publication.
- Expert mask expansion must be explicitly acknowledged and recorded.
- Settings changes derive a child revision (`POST /selection-revisions/{id}/settings`); earlier overrides and prompts stay in effect. Only the initial person selection creates a parentless revision.
- `GET /selection-revisions/{id}` returns the revision with every override, prompt, and history entry inherited along its parent chain; undo/restore re-points the client at an ancestor instead of mutating history.
- Vision packages import lazily. The base/dev environment must support API and algorithm tests without CUDA or model weights; GPU workers use `uv sync --extra vision`.

## Git policy

Commit automatically after a coherent milestone passes its relevant tests. Use descriptive conventional messages, stage only milestone-owned files, and include this guide when architecture changes. Report commit hashes in the handoff.

## Remote repository

- Remote: `origin` → `git@github.com:Hshevin/MIRAI.git` (SSH). Local `main` tracks `origin/main`.
- Authentication uses the local SSH key `~/.ssh/id_ed25519` (no passphrase) registered as a GitHub SSH key. HTTPS pushes will fail without credentials; always use the SSH URL.
- Push only when the user explicitly requests it (see the non-negotiable rules above).

## Current status

Project listing and two-phase deletion are supported by the API and worker, including bounded orphan-directory cleanup. The Video home lists searchable/sortable projects with covers, storage and derived status; project opening restores a per-video revision from `mirai.revisionByVideo`, and deletion is initiated only from the home card menu.

Milestones 0–2 and the functional render slice are complete: revisioned selection, identity overrides, normalized point/box prompts, privacy settings, gallery/timeline UI, conservative compositing, optional SAM 2.1 detail refinement, PTS-aware H.264 rendering, audio mux, validation, and artifact download are implemented. SAM video-memory propagation, flow stabilization, and production GPU acceptance remain outstanding.

## Architecture decisions

- 2026-08-18: Local single-user deployment; SQLite-backed dedicated worker instead of Redis/Celery.
- 2026-08-18: Two-pass analysis/render workflow with conservative exclusion and timeline corrections.
- 2026-08-18: Exact timestamp preservation via PyAV plus FFmpeg final mux.
- 2026-08-18: Vision adapters are optional/lazy so API and identity-policy tests run on non-GPU machines.
- 2026-08-18: Selection edits form an immutable parent chain; render jobs bind to a leaf revision.
- 2026-08-18: Coarse instance polygons provide a privacy-safe functional fallback until SAM 2.1 refinement is integrated.
- 2026-08-18: Official SAM 2 is commit-pinned in the `vision` extra; `FIGURE_DETECTION_SAM2_CHECKPOINT` enables refinement without making weights part of Git.
- 2026-08-20: The worker records bounded JSONL diagnostics and full job tracebacks under `var/logs` so dependency, CUDA, and model initialization failures remain inspectable after a job ends.
- 2026-08-20: Expired running-job leases are reclaimable, and uncaught per-job failures are logged and finalized without terminating the worker loop.
- 2026-08-20: The API exposes a persistent recent-job queue joined with video names and published artifacts; the UI polls it independently of the open editor and provides progress, errors, cancellation, and downloads.
- 2026-08-20: The browser workflow uses separate Upload, Current Video, and Queue views with persistent navigation; changing views never cancels background jobs.
- 2026-08-21: The project is branded MIRAI (Masked Identity Rendering And Isolation); the package, CLI, and environment variable names are unchanged.
- 2026-08-21: Canonical remote is GitHub `Hshevin/MIRAI` over SSH; see "Remote repository".
- 2026-11-09: The UI is a four-step flow (Upload → Analyze → Choose person → Edit & export). Upload starts on file choice and queues analysis automatically; the editor is a full-height workspace (video + custom controls, inspector tabs for corrections/look/export/history, bottom timeline); jobs live in a drawer that never replaces the current view.
- 2026-11-09: The UI is bilingual (zh/en, persisted in localStorage). Colour is semantic: `--clear` means pixels kept clear, `--masked` hidden, `--warn` uncertain, `--danger` errors/hide; `--brand` is for interaction only.
- 2026-11-09: Settings edits chain from the current revision so they no longer discard corrections; revision detail, per-video revision listing, and job `revision_id` in the queue let the UI restore state after reload.
- 2026-11-09: Project summaries derive activity, analysis, revision, and export state independently; deletion tombstones projects before cancelling work and explicitly purging database rows, then safely removing project files.
- 2026-11-09: The first workflow step is the Video project home. Cards and queue entries share project reopening, revision restore is keyed by video, and destructive confirmation uses a native modal dialog with cancel focused by default.
