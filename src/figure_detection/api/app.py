import hashlib
import json
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from figure_detection.api.projects import summarize_video
from figure_detection.api.schemas import (
    HealthResponse,
    IdentityOverrideCreate,
    JobResponse,
    MaskPromptCreate,
    PersonResponse,
    QueueJobResponse,
    RenderSettings,
    RevisionDetailResponse,
    RevisionEditResponse,
    RevisionHistoryEntry,
    RevisionOverrideResponse,
    RevisionPromptResponse,
    SelectionCreate,
    SelectionRevisionResponse,
    ThumbnailResponse,
    TimelineDetectionResponse,
    VideoDeleteResponse,
    VideoListResponse,
    VideoResponse,
)
from figure_detection.domain.enums import JobKind, JobStatus, VideoState
from figure_detection.media.probe import MediaProbeError, probe_media
from figure_detection.pipeline.revisions import revision_chain
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
from figure_detection.storage.purge import purge_video


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


def _live_video(session: Session, video_id: str) -> Video:
    video = session.get(Video, video_id)
    if video is None or video.state == VideoState.DELETED:
        raise HTTPException(status_code=404, detail="Video not found")
    return video


@app.get("/api/v1/videos", response_model=VideoListResponse)
def list_videos(
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> VideoListResponse:
    videos = session.scalars(select(Video).where(Video.state != VideoState.DELETED)).all()
    summaries = sorted(
        (summarize_video(session, video) for video in videos),
        key=lambda item: item.last_activity_at,
        reverse=True,
    )[:limit]
    return VideoListResponse(
        items=summaries,
        total=len(videos),
        storage_bytes_total=sum(item.storage_bytes for item in summaries),
    )


@app.delete("/api/v1/videos/{video_id}", response_model=VideoDeleteResponse)
def delete_video(video_id: str, session: Annotated[Session, Depends(get_session)]) -> JSONResponse:
    video = _live_video(session, video_id)
    video.state = VideoState.DELETED
    jobs = session.scalars(
        select(Job).where(
            Job.video_id == video_id, Job.status.in_([JobStatus.QUEUED, JobStatus.RUNNING])
        )
    ).all()
    running = False
    cancelled_ids = []
    for job in jobs:
        cancelled_ids.append(job.id)
        job.cancel_requested = True
        if job.status == JobStatus.QUEUED:
            job.status = JobStatus.CANCELLED
            job.stage = "cancelled"
        else:
            running = True
    session.commit()
    purged = not running and purge_video(session, video_id)
    result = VideoDeleteResponse(
        id=video_id, status="deleted" if purged else "deleting", cancelled_job_ids=cancelled_ids
    )
    return JSONResponse(result.model_dump(), status_code=200 if purged else 202)


@app.get("/api/v1/videos/{video_id}", response_model=VideoResponse)
def get_video(video_id: str, session: Annotated[Session, Depends(get_session)]) -> Video:
    video = _live_video(session, video_id)
    return video


@app.get("/api/v1/videos/{video_id}/proxy", response_class=FileResponse)
def get_proxy(video_id: str, session: Annotated[Session, Depends(get_session)]) -> FileResponse:
    video = _live_video(session, video_id)
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
    person = session.get(GlobalPerson, thumbnail.person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="Person not found")
    _live_video(session, person.video_id)
    return FileResponse(thumbnail.path, media_type="image/jpeg")


@app.post(
    "/api/v1/videos/{video_id}/analysis-jobs",
    response_model=JobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_analysis_job(video_id: str, session: Annotated[Session, Depends(get_session)]) -> Job:
    video = _live_video(session, video_id)
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
    _live_video(session, job.video_id)
    return job


@app.get("/api/v1/jobs", response_model=list[QueueJobResponse])
def list_jobs(
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[QueueJobResponse]:
    rows = session.execute(
        select(Job, Video)
        .join(Video, Job.video_id == Video.id)
        .where(Video.state != VideoState.DELETED)
        .order_by(Job.created_at.desc())
        .limit(limit)
    ).all()
    output = []
    for job, video in rows:
        result = json.loads(job.result_json) if job.result_json else {}
        payload = json.loads(job.payload_json) if job.payload_json else {}
        output.append(
            QueueJobResponse(
                id=job.id,
                video_id=job.video_id,
                video_name=video.original_name,
                kind=job.kind,
                status=job.status,
                stage=job.stage,
                progress=job.progress,
                cancel_requested=job.cancel_requested,
                error_code=job.error_code,
                error_detail=job.error_detail,
                result_json=job.result_json,
                artifact_id=result.get("artifact_id"),
                revision_id=payload.get("revision_id"),
                created_at=job.created_at,
            )
        )
    return output


@app.post("/api/v1/jobs/{job_id}/cancel", response_model=JobResponse)
def cancel_job(job_id: str, session: Annotated[Session, Depends(get_session)]) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _live_video(session, job.video_id)
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
    _live_video(session, video_id)
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
    _live_video(session, video_id)
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
    session: Session, parent: SelectionRevision, settings: RenderSettings | None = None
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
        settings_json=settings.model_dump_json() if settings else parent.settings_json,
        expert_acknowledged=(
            settings.expert_acknowledged if settings else parent.expert_acknowledged
        ),
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
    _live_video(session, video_id)
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


@app.get(
    "/api/v1/videos/{video_id}/selection-revisions",
    response_model=list[SelectionRevisionResponse],
)
def list_selection_revisions(
    video_id: str,
    session: Annotated[Session, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[SelectionRevisionResponse]:
    _live_video(session, video_id)
    revisions = session.scalars(
        select(SelectionRevision)
        .where(SelectionRevision.video_id == video_id)
        .order_by(SelectionRevision.ordinal.desc())
        .limit(limit)
    ).all()
    return [_revision_response(revision) for revision in revisions]


@app.get(
    "/api/v1/selection-revisions/{revision_id}",
    response_model=RevisionDetailResponse,
)
def get_selection_revision(
    revision_id: str, session: Annotated[Session, Depends(get_session)]
) -> RevisionDetailResponse:
    revision = session.get(SelectionRevision, revision_id)
    if revision is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    _live_video(session, revision.video_id)
    try:
        chain = revision_chain(session, revision)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    overrides: list[RevisionOverrideResponse] = []
    prompts: list[RevisionPromptResponse] = []
    history: list[RevisionHistoryEntry] = []
    for item in chain:
        item_overrides = session.scalars(
            select(IdentityOverride).where(IdentityOverride.revision_id == item.id)
        ).all()
        item_prompts = session.scalars(
            select(MaskPrompt).where(MaskPrompt.revision_id == item.id)
        ).all()
        overrides.extend(
            RevisionOverrideResponse(
                id=row.id,
                revision_id=item.id,
                revision_ordinal=item.ordinal,
                tracklet_id=row.tracklet_id,
                start_us=row.start_us,
                end_us=row.end_us,
                decision=row.decision,
            )
            for row in item_overrides
        )
        prompts.extend(
            RevisionPromptResponse(
                id=row.id,
                revision_id=item.id,
                revision_ordinal=item.ordinal,
                timestamp_us=row.timestamp_us,
                kind=row.kind,
                positive=row.positive,
                coordinates=json.loads(row.coordinates_json),
            )
            for row in item_prompts
        )
        if item_overrides:
            change = "override"
        elif item_prompts:
            change = "prompt"
        elif item.parent_id is None:
            change = "selection"
        else:
            change = "settings"
        history.append(
            RevisionHistoryEntry(
                id=item.id,
                parent_id=item.parent_id,
                ordinal=item.ordinal,
                change=change,
                created_at=item.created_at,
            )
        )
    return RevisionDetailResponse(
        revision=_revision_response(revision),
        overrides=overrides,
        prompts=prompts,
        history=history,
    )


@app.post(
    "/api/v1/selection-revisions/{revision_id}/settings",
    response_model=SelectionRevisionResponse,
    status_code=status.HTTP_201_CREATED,
)
def update_revision_settings(
    revision_id: str,
    payload: RenderSettings,
    session: Annotated[Session, Depends(get_session)],
) -> SelectionRevisionResponse:
    """Derive a child revision with new settings; earlier corrections stay in effect."""
    parent = session.get(SelectionRevision, revision_id)
    if parent is None:
        raise HTTPException(status_code=404, detail="Revision not found")
    _live_video(session, parent.video_id)
    revision = _next_revision(session, parent, payload)
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
    _live_video(session, parent.video_id)
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
    _live_video(session, parent.video_id)
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
    _live_video(session, revision.video_id)
    active_jobs = session.scalars(
        select(Job).where(
            Job.video_id == revision.video_id,
            Job.kind == job_kind,
            Job.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]),
        )
    )
    for active_job in active_jobs:
        if json.loads(active_job.payload_json).get("revision_id") == revision.id:
            return active_job
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
    _live_video(session, artifact.video_id)
    return FileResponse(
        artifact.path,
        media_type="video/mp4",
        filename="privacy-filtered.mp4" if artifact.kind == "render" else "preview.mp4",
    )


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run("figure_detection.api.app:app", host=settings.host, port=settings.port)
