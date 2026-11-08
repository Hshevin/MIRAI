import json
import os
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from figure_detection.api import app as api
from figure_detection.api.projects import summarize_video
from figure_detection.api.schemas import SelectionCreate
from figure_detection.domain.enums import JobStatus, VideoState
from figure_detection.settings import get_settings
from figure_detection.storage.database import Base
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
from figure_detection.storage.purge import (
    purge_deleted_videos,
    purge_video,
    sweep_orphan_project_dirs,
)


def test_purge_waits_for_running_job_and_is_idempotent(tmp_path, monkeypatch):
    from figure_detection.storage.purge import purge_video

    monkeypatch.setenv("FIGURE_DETECTION_RUNTIME_DIR", str(tmp_path))
    get_settings.cache_clear()
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            video_id = str(uuid4())
            project = get_settings().projects_dir / video_id
            project.mkdir(parents=True)
            source = project / "source.bin"
            source.write_bytes(b"video")
            video = Video(
                id=video_id,
                original_name="clip",
                source_path=str(source),
                sha256="0" * 64,
                size_bytes=5,
                state=VideoState.READY,
            )
            session.add(video)
            session.commit()
            assert not purge_video(session, video_id)
            video.state = VideoState.DELETED
            job = Job(video_id=video_id, status=JobStatus.RUNNING)
            session.add(job)
            session.commit()
            assert not purge_video(session, video_id)
            assert source.exists()
            job.status = JobStatus.CANCELLED
            session.commit()
            assert purge_video(session, video_id)
            assert not project.exists()
            assert session.get(Video, video_id) is None
            assert not purge_video(session, video_id)
    finally:
        get_settings.cache_clear()


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setenv("FIGURE_DETECTION_RUNTIME_DIR", str(tmp_path))
    get_settings.cache_clear()
    engine = create_engine(f"sqlite:///{tmp_path / 'projects.db'}")
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        video_id = str(uuid4())
        directory = get_settings().projects_dir / video_id
        directory.mkdir(parents=True)
        source = directory / "source.bin"
        source.write_bytes(b"source")
        video = Video(
            id=video_id,
            original_name="clip.mp4",
            source_path=str(source),
            sha256="0" * 64,
            size_bytes=6,
            state=VideoState.READY,
        )
        session.add(video)
        session.flush()
        shot = Shot(video_id=video_id, ordinal=0, start_pts=0, time_base_num=1, time_base_den=10)
        session.add(shot)
        session.flush()
        frame = Frame(
            video_id=video_id,
            shot_id=shot.id,
            ordinal=0,
            pts=0,
            time_base_num=1,
            time_base_den=10,
            timestamp_us=0,
        )
        tracklet = Tracklet(
            video_id=video_id, shot_id=shot.id, tracker_id=1, start_us=0, end_us=100
        )
        person = GlobalPerson(video_id=video_id, display_label="P001", screen_time_us=100)
        session.add_all([frame, tracklet, person])
        session.flush()
        revision = SelectionRevision(video_id=video_id, person_id=person.id, ordinal=1)
        thumbnail = Thumbnail(
            person_id=person.id,
            tracklet_id=tracklet.id,
            timestamp_us=0,
            path=str(directory / "thumb.jpg"),
            quality_score=0.9,
        )
        session.add_all([revision, thumbnail])
        session.flush()
        artifact = Artifact(
            video_id=video_id,
            revision_id=revision.id,
            kind="render",
            path=str(directory / "render.mp4"),
            size_bytes=6,
            sha256="0" * 64,
            valid=True,
        )
        session.add_all(
            [
                artifact,
                Detection(
                    frame_id=frame.id, tracklet_id=tracklet.id, x1=0, y1=0, x2=1, y2=1, confidence=1
                ),
                PersonMembership(
                    person_id=person.id,
                    tracklet_id=tracklet.id,
                    status="confirmed",
                    association_score=1,
                ),
                IdentityOverride(
                    revision_id=revision.id,
                    tracklet_id=tracklet.id,
                    start_us=0,
                    end_us=100,
                    decision="include",
                ),
                MaskPrompt(
                    revision_id=revision.id,
                    timestamp_us=0,
                    kind="point",
                    coordinates_json="[0.5,0.5]",
                ),
            ]
        )
        Path(thumbnail.path).write_bytes(b"thumb")
        Path(artifact.path).write_bytes(b"render")
        session.commit()
        yield session, video, person, revision, thumbnail, artifact, directory
    engine.dispose()
    get_settings.cache_clear()


def test_list_summary_and_activity_order(project):
    session, video, person, revision, thumbnail, artifact, directory = project
    later = datetime.now(UTC) + timedelta(days=1)
    other = Video(
        original_name="later",
        source_path=str(directory.parent / "other" / "source"),
        sha256="1" * 64,
        size_bytes=0,
    )
    hidden = Video(
        original_name="hidden",
        source_path=str(directory.parent / "hidden" / "source"),
        sha256="2" * 64,
        size_bytes=0,
        state=VideoState.DELETED,
    )
    session.add_all([other, hidden])
    session.flush()
    session.add(Job(video_id=video.id, kind="analysis", status="succeeded", updated_at=later))
    # Higher-quality thumbnail on a less visible person must not become the cover.
    short = GlobalPerson(video_id=video.id, display_label="P002", screen_time_us=1)
    session.add(short)
    session.flush()
    session.add(
        Thumbnail(
            person_id=short.id,
            tracklet_id=thumbnail.tracklet_id,
            timestamp_us=0,
            path="unused",
            quality_score=1,
        )
    )
    session.add(
        Artifact(
            video_id=video.id,
            kind="render",
            path="invalid",
            size_bytes=0,
            sha256="0" * 64,
            valid=False,
            created_at=later,
        )
    )
    session.commit()
    result = api.list_videos(session)
    assert result.total == 2
    assert result.items[0].id == video.id
    summary = result.items[0]
    assert summary.storage_bytes == sum(
        p.stat().st_size for p in directory.rglob("*") if p.is_file()
    )
    assert summary.cover_thumbnail_id == thumbnail.id
    assert summary.latest_render.artifact_id == artifact.id
    assert summary.latest_revision.id == revision.id
    assert summary.person_count == 2
    assert summary.latest_analysis.status == "succeeded"
    assert result.storage_bytes_total == summary.storage_bytes
    assert summarize_video(session, other).storage_bytes == 0


@pytest.mark.parametrize("queued", [False, True])
def test_idle_deletion_removes_all_tables_and_files(project, queued):
    session, video, *_, directory = project
    video_id = video.id
    job = Job(video_id=video_id) if queued else None
    if job:
        session.add(job)
        session.commit()
    expected_ids = [job.id] if job else []
    response = api.delete_video(video_id, session)
    data = json.loads(response.body)
    assert response.status_code == 200
    assert data["status"] == "deleted"
    assert data["cancelled_job_ids"] == expected_ids
    for table in Base.metadata.sorted_tables:
        assert session.scalar(select(func.count()).select_from(table)) == 0, table.name
    assert not directory.exists()
    with pytest.raises(HTTPException) as exc:
        api.delete_video(video_id, session)
    assert exc.value.status_code == 404


def test_running_delete_hides_all_resources_then_purges(project):
    session, video, person, revision, thumbnail, artifact, directory = project
    job = Job(video_id=video.id, status=JobStatus.RUNNING)
    session.add(job)
    session.commit()
    response = api.delete_video(video.id, session)
    assert response.status_code == 202
    assert json.loads(response.body)["status"] == "deleting"
    assert job.cancel_requested
    assert directory.exists()
    assert video.state == VideoState.DELETED
    calls = [
        lambda: api.get_video(video.id, session),
        lambda: api.get_proxy(video.id, session),
        lambda: api.list_people(video.id, session),
        lambda: api.get_timeline(video.id, session),
        lambda: api.create_selection(video.id, SelectionCreate(person_id=person.id), session),
        lambda: api.get_selection_revision(revision.id, session),
        lambda: api.download_artifact(artifact.id, session),
        lambda: api.get_thumbnail(thumbnail.id, session),
        lambda: api.create_analysis_job(video.id, session),
        lambda: api.list_selection_revisions(video.id, session),
        lambda: api.create_revision_job(revision.id, "render", session),
        lambda: api.get_job(job.id, session),
    ]
    for call in calls:
        with pytest.raises(HTTPException) as exc:
            call()
        assert exc.value.status_code == 404
    assert api.list_jobs(session) == []
    assert api.list_videos(session).items == []
    job.status = JobStatus.CANCELLED
    session.commit()
    video_id = video.id
    assert purge_deleted_videos(session) == [video_id]
    assert not directory.exists()


def test_purge_never_removes_external_files(project, tmp_path):
    session, video, *_ = project
    external = tmp_path / "external"
    external.mkdir()
    source = external / "source.bin"
    source.write_bytes(b"keep")
    video.source_path = str(source)
    video.state = VideoState.DELETED
    session.commit()
    assert purge_video(session, video.id)
    assert source.read_bytes() == b"keep"


def test_orphan_sweep_respects_age_names_known_ids_and_symlinks(tmp_path):
    root = tmp_path / "projects"
    root.mkdir()
    old, recent, known = [root / str(uuid4()) for _ in range(3)]
    non_uuid = root / "not-a-project"
    touched = root / str(uuid4())
    for directory in (old, recent, known, non_uuid, touched):
        directory.mkdir()
    nested = touched / "nested"
    nested.mkdir()
    (nested / "upload").write_bytes(b"new")
    past = time.time() - 7200
    for directory in (old, known, non_uuid, touched, nested):
        os.utime(directory, (past, past))
    outside = tmp_path / "outside"
    outside.mkdir()
    link = root / str(uuid4())
    link.symlink_to(outside, target_is_directory=True)
    assert sweep_orphan_project_dirs(root, {known.name}) == [old]
    assert all(p.exists() for p in (recent, known, non_uuid, touched, outside, link))
