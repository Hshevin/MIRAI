import hashlib
import json
import subprocess
from collections import defaultdict
from pathlib import Path

import av
import cv2
import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from figure_detection.api.schemas import RenderSettings
from figure_detection.media.frames import iter_video_frames
from figure_detection.media.probe import probe_media
from figure_detection.pipeline.compositor import (
    AnonymizationSettings,
    composite_primary,
    polygon_mask,
)
from figure_detection.pipeline.revisions import resolve_selection
from figure_detection.storage.models import Artifact, Detection, Frame, Video
from figure_detection.vision.adapters import PrimaryMaskRefiner


class RenderError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _mux(
    source_video: Path,
    encoded_video: Path,
    destination: Path,
    audio_codec: str | None,
    preview_seconds: int | None,
) -> None:
    audio_args = (
        ["-c:a", "copy"]
        if audio_codec in {"aac", "mp3", "ac3", "eac3", "alac"}
        else [
            "-c:a",
            "aac",
            "-b:a",
            "192k",
        ]
    )
    command = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(encoded_video),
        "-i",
        str(source_video),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-c:v",
        "copy",
        *audio_args,
        "-movflags",
        "+faststart",
    ]
    if preview_seconds is not None:
        command.extend(["-t", str(preview_seconds)])
    command.append(str(destination))
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=7200)
    except (OSError, subprocess.SubprocessError) as exc:
        destination.unlink(missing_ok=True)
        raise RenderError(f"FFmpeg mux failed: {exc}") from exc


def render_video(
    session: Session,
    video: Video,
    revision_id: str,
    *,
    preview_seconds: int | None = None,
    progress=None,
    mask_refiner: PrimaryMaskRefiner | None = None,
) -> Artifact:
    selection = resolve_selection(session, revision_id)
    render_settings = RenderSettings.model_validate_json(selection.revision.settings_json)
    settings = AnonymizationSettings(
        mosaic_block=render_settings.mosaic_block,
        blur_sigma=render_settings.blur_sigma,
        mask_margin=render_settings.mask_margin,
        edge_smoothing=render_settings.edge_smoothing,
    )
    relevant_tracklets = set(selection.confirmed_tracklets)
    relevant_tracklets.update(item.tracklet_id for item in selection.overrides)
    rows = session.execute(
        select(Detection, Frame)
        .join(Frame, Detection.frame_id == Frame.id)
        .where(Frame.video_id == video.id)
        .order_by(Frame.ordinal, Detection.id)
    ).all()
    detections_by_frame: dict[int, list[tuple[Detection, int]]] = defaultdict(list)
    for detection, frame in rows:
        detections_by_frame[frame.ordinal].append((detection, frame.timestamp_us))

    project_dir = Path(video.source_path).parent
    kind = "preview" if preview_seconds is not None else "render"
    temporary = project_dir / f".{kind}-{selection.revision.id}.mkv"
    destination = project_dir / f"{kind}-{selection.revision.id}.mp4"
    first_pts: int | None = None
    encoded_count = 0
    duration_limit_us = preview_seconds * 1_000_000 if preview_seconds is not None else None

    try:
        with av.open(str(temporary), "w") as output:
            output_stream = None
            for decoded in iter_video_frames(Path(video.source_path)):
                if duration_limit_us is not None and decoded.timestamp_us > duration_limit_us:
                    break
                if output_stream is None:
                    output_stream = output.add_stream("libx264", rate=30)
                    output_stream.width = decoded.image.shape[1]
                    output_stream.height = decoded.image.shape[0]
                    output_stream.pix_fmt = "yuv420p"
                    output_stream.options = {"crf": "18", "preset": "medium"}
                primary_detections: list[Detection] = []
                primary_polygons: list[list[tuple[float, float]]] = []
                competing_polygons: list[list[tuple[float, float]]] = []
                for detection, timestamp_us in detections_by_frame.get(decoded.ordinal, []):
                    polygon = json.loads(detection.mask_polygon_json or "[]")
                    if not polygon:
                        continue
                    if detection.tracklet_id in relevant_tracklets and selection.includes(
                        detection.tracklet_id, timestamp_us
                    ):
                        primary_detections.append(detection)
                        primary_polygons.append(polygon)
                    else:
                        competing_polygons.append(polygon)
                mask = polygon_mask(decoded.image.shape[:2], primary_polygons)
                if mask_refiner is not None and primary_detections:
                    refined = np.zeros_like(mask)
                    nearby_prompts = [
                        prompt
                        for prompt in selection.prompts
                        if abs(prompt.timestamp_us - decoded.timestamp_us) <= 75_000
                    ]
                    points = [
                        (
                            prompt.coordinates[0] * decoded.image.shape[1],
                            prompt.coordinates[1] * decoded.image.shape[0],
                        )
                        for prompt in nearby_prompts
                        if prompt.kind == "point"
                    ]
                    labels = [
                        1 if prompt.positive else 0
                        for prompt in nearby_prompts
                        if prompt.kind == "point"
                    ]
                    for detection in primary_detections:
                        candidate = mask_refiner.refine(
                            decoded.image,
                            (detection.x1, detection.y1, detection.x2, detection.y2),
                            points,
                            labels,
                            render_settings.mask_threshold,
                        )
                        if candidate is not None:
                            refined = cv2.bitwise_or(refined, candidate)
                    if np.any(refined):
                        mask = refined
                if competing_polygons:
                    competing = polygon_mask(decoded.image.shape[:2], competing_polygons)
                    competing = cv2.dilate(competing, np.ones((5, 5), dtype=np.uint8))
                    mask[competing > 0] = 0
                composited = composite_primary(decoded.image, mask, settings)
                frame = av.VideoFrame.from_ndarray(composited, format="bgr24")
                first_pts = decoded.pts if first_pts is None else first_pts
                frame.pts = decoded.pts - first_pts
                frame.time_base = decoded.time_base
                for packet in output_stream.encode(frame):
                    output.mux(packet)
                encoded_count += 1
                if progress and encoded_count % 60 == 0:
                    progress(
                        "render",
                        min(0.9, decoded.timestamp_us / max(1, video.duration_us or 1) * 0.9),
                    )
            if output_stream is None:
                raise RenderError("Video contains no decodable frames")
            for packet in output_stream.encode():
                output.mux(packet)
        if progress:
            progress("mux", 0.94)
        _mux(Path(video.source_path), temporary, destination, video.audio_codec, preview_seconds)
        info = probe_media(destination)
        if info.width != video.width or info.height != video.height:
            raise RenderError("Output resolution validation failed")
        artifact = Artifact(
            video_id=video.id,
            revision_id=selection.revision.id,
            kind=kind,
            path=str(destination),
            size_bytes=destination.stat().st_size,
            sha256=_sha256(destination),
            valid=True,
        )
        session.add(artifact)
        session.commit()
        return artifact
    finally:
        temporary.unlink(missing_ok=True)
