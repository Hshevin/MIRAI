import hashlib
import json
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from figure_detection.api.schemas import (
    HealthResponse,
    IdentityOverrideCreate,
    JobResponse,
    MaskPromptCreate,
    PersonResponse,
    RevisionEditResponse,
    SelectionCreate,
    SelectionRevisionResponse,
    ThumbnailResponse,
    TimelineDetectionResponse,
    VideoResponse,
)
from figure_detection.domain.enums import JobKind, JobStatus, VideoState
from figure_detection.media.probe import MediaProbeError, probe_media
from figure_detection.settings import get_settings
from figure_detection.storage.database import create_schema, get_session
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
    Thumbnail,
    Tracklet,
    Video,
)


def _binary_available(name: str) -> bool:
    return shutil.which(name) is not None


def _cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except ImportError:
        return False


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.ensure_directories()
    create_schema()
    yield


app = FastAPI(title="Figure Detection API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    ffmpeg = _binary_available(settings.ffmpeg_binary)
    ffprobe = _binary_available(settings.ffprobe_binary)
    return HealthResponse(
        status="ready" if ffmpeg and ffprobe else "degraded",
        ffmpeg=ffmpeg,
        ffprobe=ffprobe,
        cuda=_cuda_available(),
    )


@app.post("/api/v1/videos", response_model=VideoResponse, status_code=status.HTTP_201_CREATED)
async def upload_video(
    upload: Annotated[UploadFile, File()],
    session: Annotated[Session, Depends(get_session)],
) -> Video:
    settings = get_settings()
    video_id = str(uuid4())
    project_dir = settings.projects_dir / video_id
    project_dir.mkdir(parents=True, exist_ok=False)
    source_path = project_dir / "source.bin"
    digest = hashlib.sha256()
    size = 0
    try:
        with source_path.open("wb") as output:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(
                        status_code=413, detail="Upload exceeds configured size limit"
                    )
                digest.update(chunk)
                output.write(chunk)
        info = probe_media(source_path, settings.ffprobe_binary)
    except HTTPException:
        shutil.rmtree(project_dir, ignore_errors=True)
        raise
    except MediaProbeError as exc:
        shutil.rmtree(project_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await upload.close()

    video = Video(
        id=video_id,
        original_name=Path(upload.filename or "video").name,
        source_path=str(source_path),
        sha256=digest.hexdigest(),
        size_bytes=size,
        state=VideoState.UPLOADED,
        width=info.width,
        height=info.height,
        duration_us=info.duration_us,
        video_codec=info.video_codec,
        audio_codec=info.audio_codec,
        has_audio=info.has_audio,
        probe_json=info.to_json(),
    )
    session.add(video)
    session.commit()
    session.refresh(video)
    return video


@app.get("/api/v1/videos/{video_id}", response_model=VideoResponse)
def get_video(video_id: str, session: Annotated[Session, Depends(get_session)]) -> Video:
    video = session.get(Video, video_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found")
    return video


@app.get("/api/v1/videos/{video_id}/proxy", response_class=FileResponse)
def get_proxy(video_id: str, session: Annotated[Session, Depends(get_session)]) -> FileResponse:
    video = session.get(Video, video_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found")
    path = Path(video.source_path).parent / "proxy.mp4"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Proxy not available")
    return FileResponse(path, media_type="video/mp4", filename="proxy.mp4")


@app.get("/api/v1/thumbnails/{thumbnail_id}", response_class=FileResponse)
def get_thumbnail(
    thumbnail_id: str, session: Annotated[Session, Depends(get_session)]
) -> FileResponse:
    thumbnail = session.get(Thumbnail, thumbnail_id)
    if thumbnail is None or not Path(thumbnail.path).is_file():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(thumbnail.path, media_type="image/jpeg")


@app.post(
    "/api/v1/videos/{video_id}/analysis-jobs",
    response_model=JobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_analysis_job(video_id: str, session: Annotated[Session, Depends(get_session)]) -> Job:
    video = session.get(Video, video_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found")
    existing = session.scalar(
        select(Job).where(
            Job.video_id == video_id,
            Job.kind == JobKind.ANALYSIS,
            Job.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]),
        )
    )
    if existing:
        return existing
    job = Job(video_id=video_id, kind=JobKind.ANALYSIS, payload_json=json.dumps({}))
    video.state = VideoState.ANALYZING
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


@app.get("/api/v1/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str, session: Annotated[Session, Depends(get_session)]) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.post("/api/v1/jobs/{job_id}/cancel", response_model=JobResponse)
def cancel_job(job_id: str, session: Annotated[Session, Depends(get_session)]) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in {JobStatus.QUEUED, JobStatus.RUNNING}:
        job.cancel_requested = True
        if job.status == JobStatus.QUEUED:
            job.status = JobStatus.CANCELLED
            job.stage = "cancelled"
        session.commit()
        session.refresh(job)
    return job


@app.get("/api/v1/videos/{video_id}/people", response_model=list[PersonResponse])
def list_people(
    video_id: str, session: Annotated[Session, Depends(get_session)]
) -> list[PersonResponse]:
    if session.get(Video, video_id) is None:
        raise HTTPException(status_code=404, detail="Video not found")
    people = session.scalars(
        select(GlobalPerson)
        .where(GlobalPerson.video_id == video_id)
        .order_by(GlobalPerson.display_label)
    ).all()
    output: list[PersonResponse] = []
    for person in people:
        ambiguous = session.scalar(
            select(func.count(PersonMembership.id)).where(
                PersonMembership.person_id == person.id,
                PersonMembership.status == "ambiguous",
            )
        )
        thumbnails = session.scalars(
            select(Thumbnail)
            .where(Thumbnail.person_id == person.id)
            .order_by(Thumbnail.quality_score.desc())
            .limit(5)
        ).all()
        output.append(
            PersonResponse(
                id=person.id,
                display_label=person.display_label,
                screen_time_us=person.screen_time_us,
                detected_frames=person.detected_frames,
                appearance_count=person.appearance_count,
                detector_confidence=person.detector_confidence,
                association_score=person.association_score,
                ambiguous_appearances=int(ambiguous or 0),
                thumbnails=[
                    ThumbnailResponse(
                        id=item.id,
                        timestamp_us=item.timestamp_us,
                        quality_score=item.quality_score,
                    )
                    for item in thumbnails
                ],
            )
        )
    return output


@app.get("/api/v1/videos/{video_id}/timeline", response_model=list[TimelineDetectionResponse])
def get_timeline(
    video_id: str,
    session: Annotated[Session, Depends(get_session)],
    start_us: Annotated[int, Query(ge=0)] = 0,
    end_us: Annotated[int | None, Query(gt=0)] = None,
) -> list[TimelineDetectionResponse]:
    query = (
        select(Detection, Frame, PersonMembership)
        .join(Frame, Detection.frame_id == Frame.id)
        .outerjoin(PersonMembership, PersonMembership.tracklet_id == Detection.tracklet_id)
        .where(Frame.video_id == video_id, Frame.timestamp_us >= start_us)
        .order_by(Frame.timestamp_us, Detection.id)
    )
    if end_us is not None:
        query = query.where(Frame.timestamp_us <= end_us)
    rows = session.execute(query).all()
    return [
        TimelineDetectionResponse(
            timestamp_us=frame.timestamp_us,
            tracklet_id=detection.tracklet_id,
            person_id=membership.person_id if membership else None,
            membership_status=membership.status if membership else None,
            box=(detection.x1, detection.y1, detection.x2, detection.y2),
            confidence=detection.confidence,
        )
        for detection, frame, membership in rows
    ]


def _revision_response(revision: SelectionRevision) -> SelectionRevisionResponse:
    return SelectionRevisionResponse(
        id=revision.id,
        video_id=revision.video_id,
        person_id=revision.person_id,
        parent_id=revision.parent_id,
        ordinal=revision.ordinal,
        settings=json.loads(revision.settings_json),
        created_at=revision.created_at,
    )


def _next_revision(
    session: Session, parent: SelectionRevision, settings_json: str | None = None
) -> SelectionRevision:
    ordinal = (
        session.scalar(
            select(func.max(SelectionRevision.ordinal)).where(
                SelectionRevision.video_id == parent.video_id
            )
        )
        or 0
    ) + 1
    revision = SelectionRevision(
        video_id=parent.video_id,
        person_id=parent.person_id,
        parent_id=parent.id,
        ordinal=ordinal,
        settings_json=settings_json or parent.settings_json,
        expert_acknowledged=parent.expert_acknowledged,
    )
    session.add(revision)
    session.flush()
    return revision


@app.post(
    "/api/v1/videos/{video_id}/selection-revisions",
    response_model=SelectionRevisionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_selection(
    video_id: str,
    payload: SelectionCreate,
    session: Annotated[Session, Depends(get_session)],
) -> SelectionRevisionResponse:
    person = session.get(GlobalPerson, payload.person_id)
    if person is None or person.video_id != video_id:
        raise HTTPException(status_code=404, detail="Person not found in video")
    ordinal = (
        session.scalar(
            select(func.max(SelectionRevision.ordinal)).where(
                SelectionRevision.video_id == video_id
            )
        )
        or 0
    ) + 1
    revision = SelectionRevision(
        video_id=video_id,
        person_id=person.id,
        ordinal=ordinal,
        settings_json=payload.settings.model_dump_json(),
        expert_acknowledged=payload.settings.expert_acknowledged,
    )
    session.add(revision)
    session.commit()
    session.refresh(revision)
    return _revision_response(revision)


@app.post(
    "/api/v1/selection-revisions/{revision_id}/identity-overrides",
    response_model=RevisionEditResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_identity_override(
    revision_id: str,
    payload: IdentityOverrideCreate,
    session: Annotated[Session, Depends(get_session)],
) -> RevisionEditResponse:
    parent = session.get(SelectionRevision, revision_id)
    tracklet = session.get(Tracklet, payload.tracklet_id)
    if parent is None or tracklet is None or tracklet.video_id != parent.video_id:
        raise HTTPException(status_code=404, detail="Revision or tracklet not found")
    revision = _next_revision(session, parent)
    override = IdentityOverride(
        revision_id=revision.id,
        tracklet_id=tracklet.id,
        start_us=payload.start_us,
        end_us=payload.end_us,
        decision=payload.decision,
    )
    session.add(override)
    session.commit()
    session.refresh(revision)
    return RevisionEditResponse(revision=_revision_response(revision), edit_id=override.id)


@app.post(
    "/api/v1/selection-revisions/{revision_id}/mask-prompts",
    response_model=RevisionEditResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_mask_prompt(
    revision_id: str,
    payload: MaskPromptCreate,
    session: Annotated[Session, Depends(get_session)],
) -> RevisionEditResponse:
    parent = session.get(SelectionRevision, revision_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    revision = _next_revision(session, parent)
    prompt = MaskPrompt(
        revision_id=revision.id,
        timestamp_us=payload.timestamp_us,
        kind=payload.kind,
        positive=payload.positive,
        coordinates_json=json.dumps(payload.coordinates),
    )
    session.add(prompt)
    session.commit()
    session.refresh(revision)
    return RevisionEditResponse(revision=_revision_response(revision), edit_id=prompt.id)


@app.post(
    "/api/v1/selection-revisions/{revision_id}/{job_kind}-jobs",
    response_model=JobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_revision_job(
    revision_id: str,
    job_kind: Literal["preview", "render"],
    session: Annotated[Session, Depends(get_session)],
) -> Job:
    revision = session.get(SelectionRevision, revision_id)
    if revision is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    job = Job(
        video_id=revision.video_id,
        kind=job_kind,
        payload_json=json.dumps({"revision_id": revision.id}),
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


@app.get("/api/v1/artifacts/{artifact_id}/download", response_class=FileResponse)
def download_artifact(
    artifact_id: str, session: Annotated[Session, Depends(get_session)]
) -> FileResponse:
    artifact = session.get(Artifact, artifact_id)
    if artifact is None or not artifact.valid or not Path(artifact.path).is_file():
        raise HTTPException(status_code=404, detail="Validated artifact not found")
    return FileResponse(
        artifact.path,
        media_type="video/mp4",
        filename="privacy-filtered.mp4" if artifact.kind == "render" else "preview.mp4",
    )


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run("figure_detection.api.app:app", host=settings.host, port=settings.port)
