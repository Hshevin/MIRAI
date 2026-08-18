from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from figure_detection.domain.enums import JobKind, JobStatus, VideoState
from figure_detection.storage.database import Base


def new_id() -> str:
    return str(uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class Video(Base):
    __tablename__ = "videos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    original_name: Mapped[str] = mapped_column(String(512))
    source_path: Mapped[str] = mapped_column(Text, unique=True)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(32), default=VideoState.UPLOADED)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration_us: Mapped[int | None] = mapped_column(Integer)
    video_codec: Mapped[str | None] = mapped_column(String(64))
    audio_codec: Mapped[str | None] = mapped_column(String(64))
    has_audio: Mapped[bool] = mapped_column(Boolean, default=False)
    probe_json: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    jobs: Mapped[list["Job"]] = relationship(back_populates="video", cascade="all, delete")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default=JobKind.ANALYSIS)
    status: Mapped[str] = mapped_column(String(32), default=JobStatus.QUEUED, index=True)
    stage: Mapped[str] = mapped_column(String(64), default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    result_json: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_detail: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    lease_owner: Mapped[str | None] = mapped_column(String(128))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    video: Mapped[Video] = relationship(back_populates="jobs")


class Shot(Base):
    __tablename__ = "shots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    start_pts: Mapped[int] = mapped_column(Integer)
    end_pts: Mapped[int | None] = mapped_column(Integer)
    time_base_num: Mapped[int] = mapped_column(Integer)
    time_base_den: Mapped[int] = mapped_column(Integer)
    cut_confidence: Mapped[float] = mapped_column(Float, default=1.0)

    __table_args__ = (UniqueConstraint("video_id", "ordinal"),)


class Frame(Base):
    __tablename__ = "frames"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    shot_id: Mapped[str] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    pts: Mapped[int] = mapped_column(Integer)
    duration: Mapped[int | None] = mapped_column(Integer)
    time_base_num: Mapped[int] = mapped_column(Integer)
    time_base_den: Mapped[int] = mapped_column(Integer)
    timestamp_us: Mapped[int] = mapped_column(Integer, index=True)
    is_keyframe: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (UniqueConstraint("video_id", "ordinal"),)


class Tracklet(Base):
    __tablename__ = "tracklets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    shot_id: Mapped[str] = mapped_column(ForeignKey("shots.id", ondelete="CASCADE"), index=True)
    tracker_id: Mapped[int] = mapped_column(Integer)
    start_us: Mapped[int] = mapped_column(Integer)
    end_us: Mapped[int] = mapped_column(Integer)
    detected_frames: Mapped[int] = mapped_column(Integer, default=0)
    mean_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    embedding_json: Mapped[str | None] = mapped_column(Text)
    embedding_variance: Mapped[float | None] = mapped_column(Float)
    quality_score: Mapped[float] = mapped_column(Float, default=0.0)

    __table_args__ = (UniqueConstraint("shot_id", "tracker_id"),)


class Detection(Base):
    __tablename__ = "detections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    frame_id: Mapped[int] = mapped_column(ForeignKey("frames.id", ondelete="CASCADE"), index=True)
    tracklet_id: Mapped[str] = mapped_column(
        ForeignKey("tracklets.id", ondelete="CASCADE"), index=True
    )
    x1: Mapped[float] = mapped_column(Float)
    y1: Mapped[float] = mapped_column(Float)
    x2: Mapped[float] = mapped_column(Float)
    y2: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    mask_polygon_json: Mapped[str | None] = mapped_column(Text)


class GlobalPerson(Base):
    __tablename__ = "global_people"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    display_label: Mapped[str] = mapped_column(String(16))
    screen_time_us: Mapped[int] = mapped_column(Integer, default=0)
    detected_frames: Mapped[int] = mapped_column(Integer, default=0)
    appearance_count: Mapped[int] = mapped_column(Integer, default=0)
    detector_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    association_score: Mapped[float] = mapped_column(Float, default=0.0)

    __table_args__ = (UniqueConstraint("video_id", "display_label"),)


class PersonMembership(Base):
    __tablename__ = "person_memberships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    person_id: Mapped[str] = mapped_column(
        ForeignKey("global_people.id", ondelete="CASCADE"), index=True
    )
    tracklet_id: Mapped[str] = mapped_column(
        ForeignKey("tracklets.id", ondelete="CASCADE"), unique=True
    )
    status: Mapped[str] = mapped_column(String(32))
    association_score: Mapped[float] = mapped_column(Float)
    nearest_negative_margin: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(16), default="auto")


class Thumbnail(Base):
    __tablename__ = "thumbnails"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    person_id: Mapped[str] = mapped_column(
        ForeignKey("global_people.id", ondelete="CASCADE"), index=True
    )
    tracklet_id: Mapped[str] = mapped_column(ForeignKey("tracklets.id", ondelete="CASCADE"))
    timestamp_us: Mapped[int] = mapped_column(Integer)
    path: Mapped[str] = mapped_column(Text)
    quality_score: Mapped[float] = mapped_column(Float)


class SelectionRevision(Base):
    __tablename__ = "selection_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    person_id: Mapped[str] = mapped_column(
        ForeignKey("global_people.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("selection_revisions.id", ondelete="SET NULL")
    )
    ordinal: Mapped[int] = mapped_column(Integer)
    settings_json: Mapped[str] = mapped_column(Text, default="{}")
    expert_acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (UniqueConstraint("video_id", "ordinal"),)


class IdentityOverride(Base):
    __tablename__ = "identity_overrides"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    revision_id: Mapped[str] = mapped_column(
        ForeignKey("selection_revisions.id", ondelete="CASCADE"), index=True
    )
    tracklet_id: Mapped[str] = mapped_column(ForeignKey("tracklets.id", ondelete="CASCADE"))
    start_us: Mapped[int] = mapped_column(Integer)
    end_us: Mapped[int] = mapped_column(Integer)
    decision: Mapped[str] = mapped_column(String(16))


class MaskPrompt(Base):
    __tablename__ = "mask_prompts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    revision_id: Mapped[str] = mapped_column(
        ForeignKey("selection_revisions.id", ondelete="CASCADE"), index=True
    )
    timestamp_us: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))
    positive: Mapped[bool] = mapped_column(Boolean, default=True)
    coordinates_json: Mapped[str] = mapped_column(Text)


class Artifact(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    video_id: Mapped[str] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    revision_id: Mapped[str | None] = mapped_column(
        ForeignKey("selection_revisions.id", ondelete="SET NULL"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    path: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    valid: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
