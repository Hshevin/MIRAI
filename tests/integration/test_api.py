from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from figure_detection.api.app import health, list_jobs
from figure_detection.settings import get_settings


def test_health(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FIGURE_DETECTION_RUNTIME_DIR", str(tmp_path))
    get_settings.cache_clear()

    response = health()
    assert response.ffmpeg is True
    assert response.ffprobe is True


def test_list_jobs_includes_video_name_and_artifact() -> None:
    job = SimpleNamespace(
        id="job-1",
        video_id="video-1",
        kind="render",
        status="succeeded",
        stage="complete",
        progress=1.0,
        cancel_requested=False,
        error_code=None,
        error_detail=None,
        result_json='{"artifact_id": "artifact-1"}',
        created_at=datetime.now(UTC),
    )
    video = SimpleNamespace(original_name="family.mov")
    session = MagicMock()
    session.execute.return_value.all.return_value = [(job, video)]

    result = list_jobs(session=session, limit=50)

    assert result[0].video_name == "family.mov"
    assert result[0].artifact_id == "artifact-1"
