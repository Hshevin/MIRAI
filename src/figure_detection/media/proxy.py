import subprocess
from pathlib import Path


class ProxyGenerationError(RuntimeError):
    pass


def generate_proxy(source: Path, destination: Path, ffmpeg_binary: str = "ffmpeg") -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_binary,
        "-y",
        "-v",
        "error",
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale='min(1280,iw)':-2",
        "-c:v",
        "libx264",
        "-crf",
        "25",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(destination),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=3600)
    except (OSError, subprocess.SubprocessError) as exc:
        destination.unlink(missing_ok=True)
        raise ProxyGenerationError(f"Unable to generate browser proxy: {exc}") from exc
