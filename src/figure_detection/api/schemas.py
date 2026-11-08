from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    result_json: str | None
    created_at: datetime


class QueueJobResponse(JobResponse):
    video_name: str
    artifact_id: str | None = None
    revision_id: str | None = None


class ThumbnailResponse(BaseModel):
    id: str
    timestamp_us: int
    quality_score: float


class PersonResponse(BaseModel):
    id: str
    display_label: str
    screen_time_us: int
    detected_frames: int
    appearance_count: int
    detector_confidence: float
    association_score: float
    ambiguous_appearances: int
    thumbnails: list[ThumbnailResponse]


class TimelineDetectionResponse(BaseModel):
    timestamp_us: int
    tracklet_id: str
    person_id: str | None
    membership_status: str | None
    box: tuple[float, float, float, float]
    confidence: float


class RenderSettings(BaseModel):
    mosaic_block: int = Field(default=32, ge=4, le=256)
    blur_sigma: float = Field(default=16.0, ge=0, le=128)
    mask_margin: int = Field(default=-3, ge=-32, le=32)
    edge_smoothing: int = Field(default=4, ge=0, le=32)
    mask_threshold: float = Field(default=0.70, ge=0.05, le=0.99)
    privacy_mode: Literal["safe", "expert"] = "safe"
    expert_acknowledged: bool = False

    @model_validator(mode="after")
    def enforce_expert_acknowledgement(self):
        unsafe = self.mask_margin > 0 or self.mask_threshold < 0.70
        if unsafe and (self.privacy_mode != "expert" or not self.expert_acknowledged):
            raise ValueError("Mask expansion or lower thresholds require acknowledged expert mode")
        return self


class SelectionCreate(BaseModel):
    person_id: str
    settings: RenderSettings = Field(default_factory=RenderSettings)


class SelectionRevisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    video_id: str
    person_id: str
    parent_id: str | None
    ordinal: int
    settings: RenderSettings
    created_at: datetime


class IdentityOverrideCreate(BaseModel):
    tracklet_id: str
    start_us: int = Field(ge=0)
    end_us: int = Field(gt=0)
    decision: Literal["include", "exclude"]

    @model_validator(mode="after")
    def validate_range(self):
        if self.end_us <= self.start_us:
            raise ValueError("end_us must be greater than start_us")
        return self


class MaskPromptCreate(BaseModel):
    timestamp_us: int = Field(ge=0)
    kind: Literal["point", "box"]
    positive: bool = True
    coordinates: list[float]

    @model_validator(mode="after")
    def validate_coordinates(self):
        required = 2 if self.kind == "point" else 4
        if len(self.coordinates) != required or any(
            value < 0 or value > 1 for value in self.coordinates
        ):
            raise ValueError(f"{self.kind} requires {required} normalized coordinates")
        return self


class RevisionEditResponse(BaseModel):
    revision: SelectionRevisionResponse
    edit_id: str


class RevisionOverrideResponse(BaseModel):
    id: str
    revision_id: str
    revision_ordinal: int
    tracklet_id: str
    start_us: int
    end_us: int
    decision: Literal["include", "exclude"]


class RevisionPromptResponse(BaseModel):
    id: str
    revision_id: str
    revision_ordinal: int
    timestamp_us: int
    kind: Literal["point", "box"]
    positive: bool
    coordinates: list[float]


class RevisionHistoryEntry(BaseModel):
    id: str
    parent_id: str | None
    ordinal: int
    change: Literal["selection", "settings", "override", "prompt"]
    created_at: datetime


class RevisionDetailResponse(BaseModel):
    revision: SelectionRevisionResponse
    overrides: list[RevisionOverrideResponse]
    prompts: list[RevisionPromptResponse]
    history: list[RevisionHistoryEntry]
