import json
import subprocess
from dataclasses import asdict, dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any


class MediaProbeError(RuntimeError):
    pass


@dataclass(frozen=True)
class MediaInfo:
    width: int
    height: int
    duration_us: int
    video_codec: str
    average_rate: str | None
    time_base: str
    start_pts: int | None
    has_audio: bool
    audio_codec: str | None
    rotation: int
    raw: dict[str, Any]

    def to_json(self) -> str:
        data = asdict(self)
        data["raw"] = self.raw
        return json.dumps(data, separators=(",", ":"))


def _duration_us(stream: dict[str, Any], payload: dict[str, Any]) -> int:
    duration = stream.get("duration") or payload.get("format", {}).get("duration")
    if duration is None:
        return 0
    return round(float(duration) * 1_000_000)


def probe_media(path: Path, ffprobe_binary: str = "ffprobe") -> MediaInfo:
    command = [
        ffprobe_binary,
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        str(path),
    ]
    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        raise MediaProbeError(f"Unable to inspect video: {exc}") from exc

    try:
        payload = json.loads(completed.stdout)
        streams = payload.get("streams", [])
        video = next(stream for stream in streams if stream.get("codec_type") == "video")
    except (json.JSONDecodeError, StopIteration) as exc:
        raise MediaProbeError("Input does not contain a readable video stream") from exc

    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    rotation = 0
    for side_data in video.get("side_data_list", []):
        if "rotation" in side_data:
            rotation = int(side_data["rotation"])
            break
    width, height = int(video["width"]), int(video["height"])
    if abs(rotation) % 180 == 90:
        width, height = height, width
    time_base = video.get("time_base", "1/1000000")
    Fraction(time_base)  # validate before persistence
    return MediaInfo(
        width=width,
        height=height,
        duration_us=_duration_us(video, payload),
        video_codec=video.get("codec_name", "unknown"),
        average_rate=video.get("avg_frame_rate"),
        time_base=time_base,
        start_pts=video.get("start_pts"),
        has_audio=audio is not None,
        audio_codec=audio.get("codec_name") if audio else None,
        rotation=rotation,
        raw=payload,
    )
