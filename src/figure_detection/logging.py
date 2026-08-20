import json
import logging
import os
import sys
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any


class JsonFormatter(logging.Formatter):
    """One JSON object per line so worker failures remain searchable and complete."""

    def format(self, record: logging.LogRecord) -> str:
        event: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "process_id": record.process,
        }
        for field in ("component", "job_id", "video_id", "job_kind", "stage"):
            value = getattr(record, field, None)
            if value is not None:
                event[field] = value
        if record.exc_info:
            event["exception"] = self.formatException(record.exc_info)
        return json.dumps(event, ensure_ascii=False)


def configure_logging(component: str, runtime_dir: Path) -> Path:
    """Configure stderr and a bounded persistent JSONL log for one process."""
    logs_dir = runtime_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = logs_dir / f"{component}.jsonl"
    formatter = JsonFormatter()

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()

    console = logging.StreamHandler()
    console.setFormatter(formatter)
    root.addHandler(console)

    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)

    logging.getLogger(__name__).info(
        "logging configured",
        extra={"component": component},
    )
    return log_path


def runtime_diagnostics() -> dict[str, Any]:
    """Return non-secret runtime details useful for dependency and CUDA failures."""
    diagnostics: dict[str, Any] = {
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "process_id": os.getpid(),
    }
    try:
        import torch

        diagnostics.update(
            torch_version=torch.__version__,
            torch_cuda_version=torch.version.cuda,
            cuda_available=torch.cuda.is_available(),
            cuda_device_count=torch.cuda.device_count(),
        )
    except Exception as exc:  # diagnostics must never prevent worker startup
        diagnostics["torch_diagnostic_error"] = f"{type(exc).__name__}: {exc}"
    return diagnostics
