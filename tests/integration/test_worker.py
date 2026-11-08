import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from figure_detection.domain.enums import JobKind, JobStatus, VideoState
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
