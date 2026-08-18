from pathlib import Path

from figure_detection.api.app import health
from figure_detection.settings import get_settings


def test_health(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FIGURE_DETECTION_RUNTIME_DIR", str(tmp_path))
    get_settings.cache_clear()

    response = health()
    assert response.ffmpeg is True
    assert response.ffprobe is True
