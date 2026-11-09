from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from figure_detection.domain.enums import JobKind, JobStatus, VideoState
from figure_detection.settings import get_settings
from figure_detection.storage.database import Base
from figure_detection.storage.models import Job, Video
from figure_detection.worker import main


@pytest.mark.parametrize("kind", list(JobKind))
def test_only_analysis_failure_marks_video_failed(tmp_path, monkeypatch, kind):
    engine = create_engine(f"sqlite:///{tmp_path / 'worker.db'}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)

    def fail(*args, **kwargs):
        raise RuntimeError("pipeline failed")

    monkeypatch.setattr(main, "require_cuda", fail)
    monkeypatch.setattr(main, "render_video", fail)
    with sessions() as session:
        video = Video(
            original_name="clip.mp4",
            source_path=str(tmp_path / "source.bin"),
            sha256="0" * 64,
            size_bytes=1,
            state=VideoState.READY,
        )
        session.add(video)
        session.flush()
        job = Job(
            video_id=video.id,
            kind=kind,
            status=JobStatus.RUNNING,
            payload_json='{"revision_id": "revision"}',
        )
        session.add(job)
        session.commit()
        video_id, job_id = video.id, job.id
    main.process_job(job_id)
    with sessions() as session:
        video = session.get(Video, video_id)
        job = session.get(Job, job_id)
        assert job.status == JobStatus.FAILED
        assert job.error_detail == "pipeline failed"
        assert video.state == (VideoState.FAILED if kind == JobKind.ANALYSIS else VideoState.READY)
        assert video.error_detail == ("pipeline failed" if kind == JobKind.ANALYSIS else None)


def test_deleted_video_job_is_cancelled(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'deleted.db'}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)

    def unexpected(*args, **kwargs):
        pytest.fail("deleted project must never execute")

    monkeypatch.setattr(main, "render_video", unexpected)
    with sessions() as session:
        video = Video(
            original_name="deleted",
            source_path=str(tmp_path / "source"),
            sha256="0" * 64,
            size_bytes=1,
            state=VideoState.DELETED,
        )
        session.add(video)
        session.flush()
        job = Job(video_id=video.id, kind=JobKind.RENDER)
        session.add(job)
        session.commit()
        job_id = job.id
    assert main.lease_next_job("test") is None
    main.process_job(job_id)
    with sessions() as session:
        assert session.get(Job, job_id).status == JobStatus.CANCELLED


@pytest.mark.parametrize(("lease_offset", "purged"), [(-3600, True), (3600, False)])
def test_deleted_video_with_crashed_job_is_purged(tmp_path, monkeypatch, lease_offset, purged):
    """A running job whose worker died must not block purging a deleted video forever."""
    monkeypatch.setenv("FIGURE_DETECTION_RUNTIME_DIR", str(tmp_path))
    get_settings.cache_clear()
    engine = create_engine(f"sqlite:///{tmp_path / 'crashed.db'}")
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(main, "SessionLocal", sessions)
    video_id = str(uuid4())
    project = get_settings().projects_dir / video_id
    project.mkdir(parents=True)
    (project / "source.bin").write_bytes(b"video")
    try:
        with sessions() as session:
            session.add(
                Video(
                    id=video_id,
                    original_name="crashed",
                    source_path=str(project / "source.bin"),
                    sha256="0" * 64,
                    size_bytes=5,
                    state=VideoState.DELETED,
                )
            )
            session.add(
                Job(
                    video_id=video_id,
                    kind=JobKind.RENDER,
                    status=JobStatus.RUNNING,
                    cancel_requested=True,
                    lease_expires_at=datetime.now(UTC) + timedelta(seconds=lease_offset),
                )
            )
            session.commit()
        main.cleanup_projects()
        assert main.lease_next_job("restarted") is None
        with sessions() as session:
            assert (session.get(Video, video_id) is None) is purged
        assert project.exists() is not purged
    finally:
        get_settings.cache_clear()
