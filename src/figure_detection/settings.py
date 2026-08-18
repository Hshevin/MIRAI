from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="FIGURE_DETECTION_", env_file=".env", extra="ignore"
    )

    app_name: str = "Figure Detection"
    host: str = "127.0.0.1"
    port: int = 8000
    runtime_dir: Path = Field(default=Path("var"))
    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    max_upload_bytes: int = 20 * 1024**3
    job_lease_seconds: int = 120
    worker_poll_seconds: float = 1.0
    sam2_checkpoint: Path | None = None
    sam2_config: str = "configs/sam2.1/sam2.1_hiera_b+.yaml"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{(self.runtime_dir / 'app.db').resolve()}"

    @property
    def projects_dir(self) -> Path:
        return self.runtime_dir / "projects"

    def ensure_directories(self) -> None:
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.projects_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
