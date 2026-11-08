"""Project summaries derived from independent analysis, revision, and export state."""

import os
from datetime import UTC
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from figure_detection.api.schemas import (
    AnalysisBrief,
    JobBrief,
    RenderBrief,
    RevisionBrief,
    VideoSummaryResponse,
)
from figure_detection.domain.enums import JobKind, JobStatus
from figure_detection.storage.models import (
    Artifact,
    GlobalPerson,
    Job,
    SelectionRevision,
    Thumbnail,
    Video,
)


def storage_bytes(path: Path) -> int:
    total = 0
    try:
        with os.scandir(path) as entries:
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        total += storage_bytes(Path(entry.path))
                    elif entry.is_file(follow_symlinks=False):
                        total += entry.stat(follow_symlinks=False).st_size
                except OSError:
                    continue
    except OSError:
        pass
    return total


def summarize_video(session: Session, video: Video) -> VideoSummaryResponse:
    jobs = select(Job).where(Job.video_id == video.id).order_by(Job.created_at.desc())
    analysis = session.scalar(jobs.where(Job.kind == JobKind.ANALYSIS).limit(1))
    active = session.scalar(
        jobs.where(Job.status.in_([JobStatus.QUEUED, JobStatus.RUNNING])).limit(1)
    )
    revision = session.scalar(
        select(SelectionRevision)
        .where(SelectionRevision.video_id == video.id)
        .order_by(SelectionRevision.ordinal.desc())
        .limit(1)
    )
    person = session.get(GlobalPerson, revision.person_id) if revision else None
    cover_person = session.scalar(
        select(GlobalPerson)
        .where(GlobalPerson.video_id == video.id)
        .order_by(GlobalPerson.screen_time_us.desc())
        .limit(1)
    )
    cover = (
        session.scalar(
            select(Thumbnail.id)
            .where(Thumbnail.person_id == cover_person.id)
            .order_by(Thumbnail.quality_score.desc())
            .limit(1)
        )
        if cover_person
        else None
    )
    render = session.scalar(
        select(Artifact)
        .where(Artifact.video_id == video.id, Artifact.kind == "render", Artifact.valid.is_(True))
        .order_by(Artifact.created_at.desc())
        .limit(1)
    )
    render_revision = (
        session.get(SelectionRevision, render.revision_id)
        if render and render.revision_id
        else None
    )
    activity = [video.updated_at]
    for model, column in ((Job, Job.updated_at), (SelectionRevision, SelectionRevision.created_at)):
        latest = session.scalar(select(func.max(column)).where(model.video_id == video.id))
        if latest:
            activity.append(latest)
    return VideoSummaryResponse(
        **{
            key: getattr(video, key)
            for key in (
                "id",
                "original_name",
                "width",
                "height",
                "duration_us",
                "size_bytes",
                "has_audio",
                "created_at",
                "state",
            )
        },
        last_activity_at=max(value.replace(tzinfo=UTC) for value in activity),
        storage_bytes=storage_bytes(Path(video.source_path).parent),
        cover_thumbnail_id=cover,
        person_count=session.scalar(
            select(func.count()).select_from(GlobalPerson).where(GlobalPerson.video_id == video.id)
        )
        or 0,
        latest_analysis=AnalysisBrief.model_validate(analysis) if analysis else None,
        active_job=JobBrief.model_validate(active) if active else None,
        latest_revision=RevisionBrief(
            id=revision.id,
            ordinal=revision.ordinal,
            person_id=revision.person_id,
            person_label=person.display_label if person else "",
            created_at=revision.created_at,
        )
        if revision
        else None,
        revision_count=session.scalar(
            select(func.count())
            .select_from(SelectionRevision)
            .where(SelectionRevision.video_id == video.id)
        )
        or 0,
        latest_render=RenderBrief(
            artifact_id=render.id,
            revision_id=render.revision_id,
            revision_ordinal=render_revision.ordinal if render_revision else None,
            created_at=render.created_at,
        )
        if render
        else None,
    )
