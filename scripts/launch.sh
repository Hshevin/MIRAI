#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/launch.sh [--no-install]

Launch the Figure Detection API, worker, and web UI on Linux or macOS.
By default, Python and frontend dependencies are installed/synchronized first.

Options:
  --no-install  Skip uv sync and npm install.
  -h, --help    Show this help.
EOF
}

install_dependencies=1
while (($#)); do
  case "$1" in
    --no-install) install_dependencies=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$(uname -s)" in
  Linux) system_name="Linux" ;;
  Darwin) system_name="macOS" ;;
  *)
    echo "This launcher supports Linux and macOS. On Windows, use scripts/launch.ps1." >&2
    exit 1
    ;;
esac

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

for command in uv node npm ffmpeg ffprobe; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

if [[ "${FIGURE_DETECTION_HOST:-127.0.0.1}" != "127.0.0.1" ]] || \
   [[ "${FIGURE_DETECTION_PORT:-8000}" != "8000" ]]; then
  echo "The launcher requires FIGURE_DETECTION_HOST=127.0.0.1 and FIGURE_DETECTION_PORT=8000." >&2
  echo "The browser client uses that local API address." >&2
  exit 1
fi

if [[ "$system_name" == "macOS" ]]; then
  echo "Detected macOS. The UI and API can run, but CUDA analysis requires Linux or Windows with an NVIDIA GPU."
else
  echo "Detected Linux."
fi

if ((install_dependencies)); then
  echo "Synchronizing Python dependencies..."
  SAM2_BUILD_CUDA=0 uv sync --extra dev --extra vision
  echo "Installing frontend dependencies..."
  npm --prefix web install
fi

child_pids=()
cleanup() {
  trap - INT TERM EXIT
  if ((${#child_pids[@]})); then
    kill "${child_pids[@]}" 2>/dev/null || true
    wait "${child_pids[@]}" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

echo "Starting API, worker, and web UI..."
uv run figure-detection-api &
child_pids+=("$!")
uv run figure-detection-worker &
child_pids+=("$!")
npm --prefix web run dev -- --host 127.0.0.1 --port 5173 --strictPort &
child_pids+=("$!")

echo "Figure Detection: http://127.0.0.1:5173"
echo "API documentation: http://127.0.0.1:8000/docs"
echo "Press Ctrl+C to stop all services."

status=0
while :; do
  for child_pid in "${child_pids[@]}"; do
    if ! kill -0 "$child_pid" 2>/dev/null; then
      set +e
      wait "$child_pid"
      status=$?
      set -e
      break 2
    fi
  done
  sleep 1
done
if ((status != 0)); then
  echo "A service exited with status $status; stopping the remaining services." >&2
else
  echo "A service stopped; stopping the remaining services."
fi
exit "$status"
