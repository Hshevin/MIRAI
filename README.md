# Figure Detection

A local, privacy-first video application that keeps one selected person visible and anonymizes every other visual pixel.

See [AGENTS.md](AGENTS.md) for the architecture, privacy invariants, and agent development rules.

## Prerequisites

- Linux, macOS, or Windows (CUDA analysis requires a supported NVIDIA setup)
- Python 3.12
- [`uv`](https://docs.astral.sh/uv/)
- Node.js 18 or newer and npm
- FFmpeg and FFprobe 6.1 or newer on `PATH`
- An NVIDIA CUDA GPU for person analysis and SAM refinement

Confirm the system tools are available:

```bash
uv --version
node --version
npm --version
ffmpeg -version
ffprobe -version
nvidia-smi
```

The web/API shell can run without a GPU, but analysis jobs require the vision dependencies and a working CUDA environment.

## 1. Install dependencies

From the repository root:

```bash
uv sync --extra dev
```

For video analysis and SAM 2 support, install the vision environment as well:

```bash
SAM2_BUILD_CUDA=0 uv sync --extra dev --extra vision
```

The CUDA extension disabled by `SAM2_BUILD_CUDA=0` is optional. PyTorch still uses CUDA for model inference.

Install the frontend dependencies:

```bash
cd web
npm install
cd ..
```

## 2. Configure SAM 2 (optional but recommended)

YOLO detection and tracking model files are downloaded automatically on first use. Internet access is therefore required for the first analysis unless those weights are already cached.

Download the SAM 2.1 Hiera Base+ checkpoint separately and set its absolute path before starting the worker:

```bash
export FIGURE_DETECTION_SAM2_CHECKPOINT=/absolute/path/to/sam2.1_hiera_base_plus.pt
```

The default SAM configuration is:

```text
configs/sam2.1/sam2.1_hiera_b+.yaml
```

Override it only when using a different compatible checkpoint:

```bash
export FIGURE_DETECTION_SAM2_CONFIG=configs/sam2.1/sam2.1_hiera_b+.yaml
```

If no SAM checkpoint is configured, export still works using conservative YOLO instance polygons. This is privacy-safe but produces less detailed and less temporally stable subject edges.

Verify that PyTorch can access the GPU:

```bash
uv run python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no CUDA GPU')"
```

## 3. Launch the application

The launchers install dependencies, then run the API, worker, and frontend together. Stop all
three services with `Ctrl+C`.

### Linux or macOS

```bash
./scripts/launch.sh
```

### Windows PowerShell

```powershell
.\scripts\launch.ps1
```

If dependencies are already installed, use `--no-install` on Linux/macOS or `-NoInstall` on
Windows. The application opens at <http://127.0.0.1:5173>. macOS can run the UI/API shell, but
the CUDA analysis worker requires a supported Linux or Windows NVIDIA environment.

### Manual launch

The API, worker, and frontend are three separate processes. Run each command in its own terminal from the repository root.

### Terminal 1: API

```bash
uv run figure-detection-api
```

Available at:

- API: <http://127.0.0.1:8000>
- Interactive API documentation: <http://127.0.0.1:8000/docs>
- Readiness check: <http://127.0.0.1:8000/api/v1/health>

### Terminal 2: processing worker

Set the SAM checkpoint in this terminal if it was not added to your shell profile, then start the worker:

```bash
export FIGURE_DETECTION_SAM2_CHECKPOINT=/absolute/path/to/sam2.1_hiera_base_plus.pt
uv run figure-detection-worker
```

The worker handles analysis, previews, and final rendering. Keep it running while using the application. GPU work is intentionally limited to one job at a time.

### Terminal 3: frontend

```bash
cd web
npm run dev
```

Open the URL printed by Vite, normally <http://127.0.0.1:5173>.

## 4. Use the application

1. Upload a video.
2. Select **Analyze people** and wait for the worker to finish.
3. Select one person from the gallery.
4. Review track ranges in the timeline.
5. Use **Include ±5s** or **Exclude ±5s** to correct identity assignments.
6. Left-click the video to add a positive subject point.
7. Right-click the video to add a negative point.
8. Generate a preview.
9. Process and download the validated output video.

Audio is retained and is not anonymized.

## Runtime data

Uploads, the SQLite database, proxies, thumbnails, previews, and rendered outputs are stored under `var/`. Model weights, runtime data, and uploaded videos are excluded from Git.

To use a different runtime directory:

```bash
export FIGURE_DETECTION_RUNTIME_DIR=/absolute/path/to/runtime-data
```

Ensure that the selected disk has at least 10 GB free and preferably at least three times the uploaded video size.

## Validation and development commands

```bash
uv run ruff check .
uv run ruff format --check .
uv run pytest

cd web
npm run build
```

## Troubleshooting

### Health endpoint reports `cuda: false`

Check `nvidia-smi`, the NVIDIA driver, and the installed PyTorch build. Restart the API and worker after correcting CUDA configuration.

### Analysis fails with a missing vision dependency

Run:

```bash
SAM2_BUILD_CUDA=0 uv sync --extra dev --extra vision
```

Then restart the worker.

### Analysis fails while downloading a model

The detector, tracker, and Re-ID libraries download model files on first use. Confirm internet access or pre-populate their model cache before launching the worker.

### SAM checkpoint not found

Use an absolute path and confirm it is readable:

```bash
ls -lh "$FIGURE_DETECTION_SAM2_CHECKPOINT"
```

If the variable is omitted, the application uses the conservative coarse-mask fallback.

### A job stays queued

The worker is not running or cannot access the same `FIGURE_DETECTION_RUNTIME_DIR` as the API. Start the worker with the same environment variables as the API.

### Port 8000 or 5173 is already in use

Change the API port with:

```bash
export FIGURE_DETECTION_PORT=8001
uv run figure-detection-api
```

If the API port changes, update the `API` constant in `web/src/main.tsx` before starting the frontend. For the frontend, Vite automatically offers another available port.
