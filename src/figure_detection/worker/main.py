import os
import socket
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select

from figure_detection.domain.enums import JobStatus
from figure_detection.settings import get_settings
from figure_detection.storage.database import SessionLocal, create_schema
from figure_detection.storage.models import Job


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
    # Pipeline dispatch is introduced in Milestone 1. Fail explicitly instead of
    # pretending that a queued analysis has completed.
    with SessionLocal.begin() as session:
        job = session.get(Job, job_id)
        if job is None:
            return
        if job.cancel_requested:
            job.status = JobStatus.CANCELLED
            job.stage = "cancelled"
            return
        job.status = JobStatus.FAILED
        job.stage = "not_implemented"
        job.error_code = "PIPELINE_NOT_IMPLEMENTED"
        job.error_detail = "Analysis pipeline is added in Milestone 1"


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
