"""Two-phase project deletion; file removal follows committed database removal."""

import logging
import os
import shutil
import time
from pathlib import Path
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from figure_detection.domain.enums import JobStatus, VideoState
from figure_detection.settings import get_settings
from figure_detection.storage.models import (
    Artifact,
    Detection,
    Frame,
    GlobalPerson,
    IdentityOverride,
    Job,
    MaskPrompt,
    PersonMembership,
    SelectionRevision,
    Shot,
    Thumbnail,
    Tracklet,
    Video,
)

logger = logging.getLogger(__name__)


def purge_video(session: Session, video_id: str) -> bool:
    """Delete every row and file of a DELETED video, unless a job is running."""
    video = session.get(Video, video_id)
    if video is None or video.state != VideoState.DELETED:
        return False
    if session.scalar(
        select(Job.id).where(Job.video_id == video_id, Job.status == JobStatus.RUNNING).limit(1)
    ):
        return False
    project_dir = Path(video.source_path).parent.resolve()
    frames = select(Frame.id).where(Frame.video_id == video_id)
    revisions = select(SelectionRevision.id).where(SelectionRevision.video_id == video_id)
    people = select(GlobalPerson.id).where(GlobalPerson.video_id == video_id)
    conditions = [
        (Detection, Detection.frame_id.in_(frames)),
        (MaskPrompt, MaskPrompt.revision_id.in_(revisions)),
        (IdentityOverride, IdentityOverride.revision_id.in_(revisions)),
        (Artifact, Artifact.video_id == video_id),
        (SelectionRevision, SelectionRevision.video_id == video_id),
        (Thumbnail, Thumbnail.person_id.in_(people)),
        (PersonMembership, PersonMembership.person_id.in_(people)),
    ]
    conditions.extend(
        (model, model.video_id == video_id) for model in (GlobalPerson, Frame, Tracklet, Shot, Job)
    )
    conditions.append((Video, Video.id == video_id))
    for model, condition in conditions:
        session.execute(
            delete(model).where(condition), execution_options={"synchronize_session": False}
        )
    session.commit()
    session.expire_all()
    if project_dir.parent != get_settings().projects_dir.resolve() or project_dir.name != video_id:
        logger.warning("Refusing unsafe project directory removal: %s", project_dir)
        return True
    try:
        shutil.rmtree(project_dir)
    except FileNotFoundError:
        pass
    except OSError:
        logger.exception("Project directory removal failed: %s", project_dir)
    return True


def purge_deleted_videos(session: Session) -> list[str]:
    ids = session.scalars(select(Video.id).where(Video.state == VideoState.DELETED)).all()
    return [video_id for video_id in ids if purge_video(session, video_id)]


def sweep_orphan_project_dirs(
    projects_dir: Path, known_ids: set[str], min_age_s: float = 3600
) -> list[Path]:
    """Remove old UUID directories only; never follow symbolic links."""
    root = projects_dir.resolve()
    removed = []
    cutoff = time.time() - min_age_s
    if not root.is_dir():
        return removed
    for path in root.iterdir():
        try:
            UUID(path.name)
        except ValueError:
            continue
        if path.name in known_ids or path.is_symlink() or not path.is_dir():
            continue
        try:
            newest = path.stat().st_mtime
            for current, dirs, files in os.walk(path, followlinks=False):
                for name in dirs + files:
                    newest = max(newest, (Path(current) / name).lstat().st_mtime)
            if newest >= cutoff:
                continue
            shutil.rmtree(path)
            removed.append(path)
        except OSError:
            logger.exception("Orphan directory cleanup failed: %s", path)
    return removed
