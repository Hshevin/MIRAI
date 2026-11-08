import json
import logging
import os
import socket
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, or_, select

from figure_detection.domain.enums import JobKind, JobStatus, VideoState
from figure_detection.logging import configure_logging, runtime_diagnostics
from figure_detection.pipeline.analysis import analyze_video
from figure_detection.pipeline.render import render_video
from figure_detection.settings import get_settings
from figure_detection.storage.database import SessionLocal, create_schema
from figure_detection.storage.models import Job, Video
from figure_detection.storage.purge import purge_deleted_videos, sweep_orphan_project_dirs
from figure_detection.vision.adapters import (
    BoxMotPersonTracker,
    BoxMotReIdEncoder,
    UltralyticsPersonDetector,
    require_cuda,
)
from figure_detection.vision.segmentation import Sam2MaskRefiner

logger = logging.getLogger(__name__)


def _enum_value(value: object) -> str:
    return str(getattr(value, "value", value))


def lease_next_job(owner: str) -> str | None:
    settings = get_settings()
    now = datetime.now(UTC)
    with SessionLocal.begin() as session:
        job = session.scalar(
            select(Job)
            .join(Video, Job.video_id == Video.id)
            .where(
                Video.state != VideoState.DELETED,
                or_(
                    Job.status == JobStatus.QUEUED,
                    and_(
                        Job.status == JobStatus.RUNNING,
                        Job.lease_expires_at.is_not(None),
                        Job.lease_expires_at < now,
                    ),
                ),
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

        if video.state == VideoState.DELETED:
            job.status = JobStatus.CANCELLED
            job.stage = "cancelled"
            session.commit()
            return

        context = {
            "component": "worker",
            "job_id": job.id,
            "video_id": job.video_id,
            "job_kind": _enum_value(job.kind),
        }
        logger.info("job started", extra=context)

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
            if job.kind == JobKind.ANALYSIS:
                logger.info("checking CUDA runtime", extra={**context, "stage": "cuda_check"})
                require_cuda()
                logger.info("initializing person detector", extra={**context, "stage": "detector"})
                detector = UltralyticsPersonDetector()
                logger.info("initializing person tracker", extra={**context, "stage": "tracker"})
                tracker = BoxMotPersonTracker()
                logger.info("initializing Re-ID encoder", extra={**context, "stage": "reid"})
                reid = BoxMotReIdEncoder()
                analyze_video(session, video, detector, tracker, reid, progress)
            elif job.kind in {JobKind.PREVIEW, JobKind.RENDER}:
                revision_id = json.loads(job.payload_json)["revision_id"]
                settings = get_settings()
                mask_refiner = (
                    Sam2MaskRefiner(settings.sam2_checkpoint, settings.sam2_config)
                    if settings.sam2_checkpoint is not None
                    else None
                )
                artifact = render_video(
                    session,
                    video,
                    revision_id,
                    preview_seconds=10 if job.kind == JobKind.PREVIEW else None,
                    progress=progress,
                    mask_refiner=mask_refiner,
                )
                job.result_json = json.dumps({"artifact_id": artifact.id})
            else:
                raise NotImplementedError(f"Unsupported job kind: {job.kind}")
            job.status = JobStatus.SUCCEEDED
            job.stage = "complete"
            job.progress = 1.0
            logger.info("job succeeded", extra=context)
        except InterruptedError:
            session.rollback()
            job = session.get(Job, job_id)
            job.status = JobStatus.CANCELLED
            job.stage = "cancelled"
        except Exception as exc:
            logger.exception("job failed", extra=context)
            session.rollback()
            job = session.get(Job, job_id)
            video = session.get(Video, job.video_id)
            job.status = JobStatus.FAILED
            job.stage = "failed"
            job.error_code = type(exc).__name__.upper()
            job.error_detail = str(exc)
            if video and video.state != VideoState.DELETED and job.kind == JobKind.ANALYSIS:
                video.state = VideoState.FAILED
                video.error_code = job.error_code
                video.error_detail = job.error_detail
        finally:
            job.lease_owner = None
            job.lease_expires_at = None
            session.commit()


def cleanup_projects(*, sweep: bool = False) -> None:
    try:
        with SessionLocal() as session:
            purge_deleted_videos(session)
            if sweep:
                known_ids = set(session.scalars(select(Video.id)))
                sweep_orphan_project_dirs(get_settings().projects_dir, known_ids)
    except Exception:
        logger.exception("Project cleanup failed; worker will continue")


def run() -> None:
    settings = get_settings()
    settings.ensure_directories()
    log_path = configure_logging("worker", settings.runtime_dir)
    logger.info(
        "worker starting",
        extra={"component": "worker"},
    )
    logger.info(
        "worker runtime diagnostics: %s",
        json.dumps(runtime_diagnostics(), sort_keys=True),
        extra={"component": "worker"},
    )
    logger.info(
        "worker log path: %s",
        log_path.resolve(),
        extra={"component": "worker"},
    )
    create_schema()
    cleanup_projects(sweep=True)
    owner = f"{socket.gethostname()}:{os.getpid()}"
    while True:
        cleanup_projects()
        if job_id := lease_next_job(owner):
            try:
                process_job(job_id)
            except Exception:
                logger.exception(
                    "unhandled worker loop failure",
                    extra={"component": "worker", "job_id": job_id},
                )
                with SessionLocal.begin() as session:
                    job = session.get(Job, job_id)
                    if job is not None:
                        job.status = JobStatus.FAILED
                        job.stage = "failed"
                        job.error_code = "WORKER_INTERNAL_ERROR"
                        job.error_detail = (
                            "The worker encountered an internal error. See "
                            f"{log_path.resolve()} for the full traceback."
                        )
                        job.lease_owner = None
                        job.lease_expires_at = None
        else:
            time.sleep(settings.worker_poll_seconds)
