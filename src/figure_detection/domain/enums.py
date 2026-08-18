from enum import StrEnum


class VideoState(StrEnum):
    UPLOADED = "uploaded"
    ANALYZING = "analyzing"
    READY = "ready"
    FAILED = "failed"
    DELETED = "deleted"


class JobKind(StrEnum):
    ANALYSIS = "analysis"
    PREVIEW = "preview"
    RENDER = "render"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MembershipStatus(StrEnum):
    CONFIRMED = "confirmed"
    AMBIGUOUS = "ambiguous"
    REJECTED = "rejected"
