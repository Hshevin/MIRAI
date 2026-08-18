import os
import socket
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select

from figure_detection.domain.enums import JobKind, JobStatus, VideoState
from figure_detection.pipeline.analysis import analyze_video
from figure_detection.settings import get_settings
from figure_detection.storage.database import SessionLocal, create_schema
from figure_detection.storage.models import Job, Video
from figure_detection.vision.adapters import (
    BoxMotPersonTracker,
    BoxMotReIdEncoder,
    UltralyticsPersonDetector,
)


def lease_next_job(owner: str) -> str | None:
    settings = get_settings()
    now = datetime.now(UTC)
    with SessionLocal.begin() as session:
        job = session.scalar(
            select(Job)
            .where(
                Job.status == JobStatus.QUEUED,
                or_(Job.lease_expires_at.is_(None), Job.lease_expires_at < now),
            )
            .order_by(Job.created_at)
            .limit(1)
        )
        if job is None:
            return None
        job.status = JobStatus.RUNNING
        job.stage = "leased"
        job.lease_owner = owner
        job.heartbeat_at = now
        job.lease_expires_at = now + timedelta(seconds=settings.job_lease_seconds)
        return job.id


def process_job(job_id: str) -> None:
    with SessionLocal() as session:
        job = session.get(Job, job_id)
        if job is None:
            return
        if job.cancel_requested:
            job.status = JobStatus.CANCELLED
            job.stage = "cancelled"
            session.commit()
            return
        video = session.get(Video, job.video_id)
        if video is None:
            job.status = JobStatus.FAILED
            job.error_code = "VIDEO_NOT_FOUND"
            session.commit()
            return

        def progress(stage: str, value: float) -> None:
            session.refresh(job)
            if job.cancel_requested:
                raise InterruptedError("Job cancelled")
            job.stage = stage
            job.progress = value
            job.heartbeat_at = datetime.now(UTC)
            job.lease_expires_at = job.heartbeat_at + timedelta(
                seconds=get_settings().job_lease_seconds
            )
            session.commit()

        try:
            if job.kind != JobKind.ANALYSIS:
                raise NotImplementedError(f"Unsupported job kind: {job.kind}")
            detector = UltralyticsPersonDetector()
            tracker = BoxMotPersonTracker()
            reid = BoxMotReIdEncoder()
            analyze_video(session, video, detector, tracker, reid, progress)
            job.status = JobStatus.SUCCEEDED
            job.stage = "complete"
            job.progress = 1.0
        except InterruptedError:
            session.rollback()
            job = session.get(Job, job_id)
            job.status = JobStatus.CANCELLED
            job.stage = "cancelled"
        except Exception as exc:
            session.rollback()
            job = session.get(Job, job_id)
            video = session.get(Video, job.video_id)
            job.status = JobStatus.FAILED
            job.stage = "failed"
            job.error_code = type(exc).__name__.upper()
            job.error_detail = str(exc)
            if video:
                video.state = VideoState.FAILED
                video.error_code = job.error_code
                video.error_detail = job.error_detail
        finally:
            job.lease_owner = None
            job.lease_expires_at = None
            session.commit()


def run() -> None:
    settings = get_settings()
    settings.ensure_directories()
    create_schema()
    owner = f"{socket.gethostname()}:{os.getpid()}"
    while True:
        if job_id := lease_next_job(owner):
            process_job(job_id)
        else:
            time.sleep(settings.worker_poll_seconds)
