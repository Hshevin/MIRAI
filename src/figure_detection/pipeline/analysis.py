import json
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray
from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from figure_detection.domain.enums import VideoState
from figure_detection.media.frames import iter_video_frames
from figure_detection.media.proxy import generate_proxy
from figure_detection.pipeline.identity import TrackletIdentity, cluster_tracklets
from figure_detection.pipeline.scene import SceneCutDetector
from figure_detection.storage.models import (
    Detection,
    Frame,
    GlobalPerson,
    PersonMembership,
    Shot,
    Thumbnail,
    Tracklet,
    Video,
)
from figure_detection.vision.adapters import PersonDetector, PersonTracker, ReIdEncoder
from figure_detection.vision.types import Embedding, PersonDetection

ProgressCallback = Callable[[str, float], None]


@dataclass
class TrackletAccumulator:
    record: Tracklet
    confidences: list[float] = field(default_factory=list)
    embeddings: list[Embedding] = field(default_factory=list)
    best_crop: NDArray[np.uint8] | None = None
    best_crop_score: float = 0.0
    best_crop_us: int = 0


def _crop_quality(image: NDArray[np.uint8], detection: PersonDetection) -> float:
    x1, y1, x2, y2 = detection.box
    width, height = max(0.0, x2 - x1), max(0.0, y2 - y1)
    area_ratio = width * height / max(1, image.shape[0] * image.shape[1])
    if width < 24 or height < 48:
        return 0.0
    clipped = x1 <= 1 or y1 <= 1 or x2 >= image.shape[1] - 1 or y2 >= image.shape[0] - 1
    return float(detection.confidence * min(1.0, area_ratio * 12) * (0.6 if clipped else 1.0))


def _crop(image: NDArray[np.uint8], box: tuple[float, float, float, float]) -> NDArray[np.uint8]:
    x1, y1, x2, y2 = box
    left = max(0, int(x1))
    top = max(0, int(y1))
    right = min(image.shape[1], int(np.ceil(x2)))
    bottom = min(image.shape[0], int(np.ceil(y2)))
    return image[top:bottom, left:right].copy()


def _aggregate_embeddings(values: list[Embedding]) -> tuple[list[float] | None, float | None]:
    if not values:
        return None, None
    matrix = np.asarray(values, dtype=np.float32)
    center = np.median(matrix, axis=0)
    norm = np.linalg.norm(center)
    if norm:
        center /= norm
    variance = float(np.mean(np.square(matrix - center)))
    return center.tolist(), variance


def _clear_previous_analysis(session: Session, video_id: str) -> None:
    # Explicit ordering keeps this independent of database cascade configuration.
    person_ids = [row[0] for row in session.query(GlobalPerson.id).filter_by(video_id=video_id)]
    if person_ids:
        session.execute(delete(Thumbnail).where(Thumbnail.person_id.in_(person_ids)))
        session.execute(delete(PersonMembership).where(PersonMembership.person_id.in_(person_ids)))
    session.execute(delete(GlobalPerson).where(GlobalPerson.video_id == video_id))
    tracklet_ids = [row[0] for row in session.query(Tracklet.id).filter_by(video_id=video_id)]
    if tracklet_ids:
        session.execute(delete(Detection).where(Detection.tracklet_id.in_(tracklet_ids)))
    session.execute(delete(Tracklet).where(Tracklet.video_id == video_id))
    session.execute(delete(Frame).where(Frame.video_id == video_id))
    session.execute(delete(Shot).where(Shot.video_id == video_id))


def analyze_video(
    session: Session,
    video: Video,
    detector: PersonDetector,
    tracker: PersonTracker,
    reid: ReIdEncoder,
    progress: ProgressCallback | None = None,
    embedding_interval: int = 15,
) -> None:
    source = Path(video.source_path)
    project_dir = source.parent
    proxy_path = project_dir / "proxy.mp4"
    if not proxy_path.exists():
        if progress:
            progress("proxy", 0.01)
        generate_proxy(source, proxy_path)

    _clear_previous_analysis(session, video.id)
    session.flush()
    cut_detector = SceneCutDetector()
    current_shot: Shot | None = None
    shot_ordinal = -1
    accumulators: dict[tuple[str, int], TrackletAccumulator] = {}
    duration_us = max(1, video.duration_us or 1)

    last_pts: int | None = None
    for decoded in iter_video_frames(source):
        last_pts = decoded.pts
        is_cut, cut_score = cut_detector.is_cut(decoded.image)
        if current_shot is None or is_cut:
            if current_shot is not None:
                current_shot.end_pts = decoded.pts - 1
            shot_ordinal += 1
            current_shot = Shot(
                video_id=video.id,
                ordinal=shot_ordinal,
                start_pts=decoded.pts,
                time_base_num=decoded.time_base.numerator,
                time_base_den=decoded.time_base.denominator,
                cut_confidence=cut_score,
            )
            session.add(current_shot)
            session.flush()
            tracker.reset()

        frame = Frame(
            video_id=video.id,
            shot_id=current_shot.id,
            ordinal=decoded.ordinal,
            pts=decoded.pts,
            duration=decoded.duration,
            time_base_num=decoded.time_base.numerator,
            time_base_den=decoded.time_base.denominator,
            timestamp_us=decoded.timestamp_us,
            is_keyframe=decoded.is_keyframe,
        )
        session.add(frame)
        session.flush()
        candidates = detector.detect(decoded.image)
        tracked = tracker.update(decoded.image, candidates)

        embeddings: list[Embedding] = []
        if tracked and decoded.ordinal % embedding_interval == 0:
            embeddings = reid.embed(
                decoded.image, [tracked_person.detection.box for tracked_person in tracked]
            )

        for index, tracked_person in enumerate(tracked):
            key = (current_shot.id, tracked_person.tracker_id)
            accumulator = accumulators.get(key)
            if accumulator is None:
                record = Tracklet(
                    video_id=video.id,
                    shot_id=current_shot.id,
                    tracker_id=tracked_person.tracker_id,
                    start_us=decoded.timestamp_us,
                    end_us=decoded.timestamp_us,
                )
                session.add(record)
                session.flush()
                accumulator = TrackletAccumulator(record)
                accumulators[key] = accumulator
            record = accumulator.record
            record.end_us = decoded.timestamp_us
            record.detected_frames += 1
            accumulator.confidences.append(tracked_person.detection.confidence)
            if index < len(embeddings):
                accumulator.embeddings.append(embeddings[index])
            quality = _crop_quality(decoded.image, tracked_person.detection)
            if quality > accumulator.best_crop_score:
                accumulator.best_crop = _crop(decoded.image, tracked_person.detection.box)
                accumulator.best_crop_score = quality
                accumulator.best_crop_us = decoded.timestamp_us
            session.add(
                Detection(
                    frame_id=frame.id,
                    tracklet_id=record.id,
                    x1=tracked_person.detection.box[0],
                    y1=tracked_person.detection.box[1],
                    x2=tracked_person.detection.box[2],
                    y2=tracked_person.detection.box[3],
                    confidence=tracked_person.detection.confidence,
                    mask_polygon_json=json.dumps(tracked_person.detection.polygon),
                )
            )

        if decoded.ordinal % 120 == 0:
            session.commit()
            if progress:
                progress("detect_track", min(0.84, decoded.timestamp_us / duration_us * 0.84))

    if current_shot is not None and last_pts is not None:
        current_shot.end_pts = last_pts

    identities: list[TrackletIdentity] = []
    for accumulator in accumulators.values():
        center, variance = _aggregate_embeddings(accumulator.embeddings)
        accumulator.record.mean_confidence = float(np.mean(accumulator.confidences))
        accumulator.record.embedding_json = json.dumps(center) if center is not None else None
        accumulator.record.embedding_variance = variance
        accumulator.record.quality_score = accumulator.best_crop_score
        identities.append(
            TrackletIdentity(
                accumulator.record.id,
                accumulator.record.start_us,
                accumulator.record.end_us,
                np.asarray(center, dtype=np.float32) if center is not None else None,
            )
        )
    session.flush()

    memberships = cluster_tracklets(identities)
    grouped: dict[int, list] = defaultdict(list)
    for membership in memberships:
        grouped[membership.cluster].append(membership)
    for ordinal, cluster_index in enumerate(sorted(grouped), start=1):
        cluster_members = grouped[cluster_index]
        cluster_accumulators = [
            next(item for item in accumulators.values() if item.record.id == member.tracklet_id)
            for member in cluster_members
        ]
        person = GlobalPerson(
            video_id=video.id,
            display_label=f"P{ordinal:03d}",
            screen_time_us=sum(
                item.record.end_us - item.record.start_us for item in cluster_accumulators
            ),
            detected_frames=sum(item.record.detected_frames for item in cluster_accumulators),
            appearance_count=len(cluster_accumulators),
            detector_confidence=float(
                np.mean([item.record.mean_confidence for item in cluster_accumulators])
            ),
            association_score=min(member.score for member in cluster_members),
        )
        session.add(person)
        session.flush()
        for member, accumulator in zip(cluster_members, cluster_accumulators, strict=True):
            session.add(
                PersonMembership(
                    person_id=person.id,
                    tracklet_id=member.tracklet_id,
                    status=member.status,
                    association_score=member.score,
                    nearest_negative_margin=member.margin,
                )
            )
            if accumulator.best_crop is not None:
                thumbnail_dir = project_dir / "thumbnails"
                thumbnail_dir.mkdir(exist_ok=True)
                thumbnail_path = thumbnail_dir / f"{accumulator.record.id}.jpg"
                ok, encoded = cv2.imencode(
                    ".jpg", accumulator.best_crop, [cv2.IMWRITE_JPEG_QUALITY, 90]
                )
                if ok:
                    thumbnail_path.write_bytes(encoded.tobytes())
                    session.add(
                        Thumbnail(
                            person_id=person.id,
                            tracklet_id=accumulator.record.id,
                            timestamp_us=accumulator.best_crop_us,
                            path=str(thumbnail_path),
                            quality_score=accumulator.best_crop_score,
                        )
                    )

    # Completion must never resurrect a project deleted during analysis.
    session.execute(
        update(Video)
        .where(Video.id == video.id, Video.state != VideoState.DELETED)
        .values(state=VideoState.READY, error_code=None, error_detail=None)
    )
    session.commit()
    if progress:
        progress("complete", 1.0)
