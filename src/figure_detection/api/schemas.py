from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: str
    ffmpeg: bool
    ffprobe: bool
    cuda: bool


class VideoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_name: str
    size_bytes: int
    state: str
    width: int | None
    height: int | None
    duration_us: int | None
    video_codec: str | None
    audio_codec: str | None
    has_audio: bool
    error_code: str | None
    created_at: datetime


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    video_id: str
    kind: str
    status: str
    stage: str
    progress: float = Field(ge=0, le=1)
    cancel_requested: bool
    error_code: str | None
    error_detail: str | None
    created_at: datetime
