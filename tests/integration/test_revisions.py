from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from figure_detection.api.app import (
    add_identity_override,
    add_mask_prompt,
    create_selection,
    get_selection_revision,
    list_selection_revisions,
    update_revision_settings,
)
from figure_detection.api.schemas import (
    IdentityOverrideCreate,
    MaskPromptCreate,
    RenderSettings,
    SelectionCreate,
)
from figure_detection.pipeline.revisions import resolve_selection
from figure_detection.storage.database import Base
from figure_detection.storage.models import GlobalPerson, Shot, Tracklet, Video


@pytest.fixture
def seeded(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        video = Video(
            original_name="clip.mp4",
            source_path=str(tmp_path / "source.bin"),
            sha256="0" * 64,
            size_bytes=1,
            has_audio=False,
        )
        session.add(video)
        session.flush()
        shot = Shot(
            video_id=video.id,
            ordinal=0,
            start_pts=0,
            end_pts=10,
            time_base_num=1,
            time_base_den=10,
        )
        session.add(shot)
        session.flush()
        tracklet = Tracklet(
            video_id=video.id,
            shot_id=shot.id,
            tracker_id=1,
            start_us=0,
            end_us=1_000_000,
            detected_frames=10,
            mean_confidence=0.9,
        )
        person = GlobalPerson(video_id=video.id, display_label="P001")
        session.add_all([tracklet, person])
        session.commit()
        yield session, video, person, tracklet


def test_settings_change_keeps_earlier_corrections(seeded) -> None:
    session, video, person, tracklet = seeded
    root = create_selection(video.id, SelectionCreate(person_id=person.id), session)
    with_override = add_identity_override(
        root.id,
        IdentityOverrideCreate(
            tracklet_id=tracklet.id, start_us=0, end_us=500_000, decision="include"
        ),
        session,
    ).revision
    with_prompt = add_mask_prompt(
        with_override.id,
        MaskPromptCreate(
            timestamp_us=100_000, kind="point", positive=False, coordinates=[0.2, 0.3]
        ),
        session,
    ).revision

    updated = update_revision_settings(with_prompt.id, RenderSettings(mosaic_block=48), session)

    assert updated.parent_id == with_prompt.id
    assert updated.settings.mosaic_block == 48
    effective = resolve_selection(session, updated.id)
    assert len(effective.overrides) == 1
    assert len(effective.prompts) == 1

    detail = get_selection_revision(updated.id, session)
    assert [entry.change for entry in detail.history] == [
        "selection",
        "override",
        "prompt",
        "settings",
    ]
    assert detail.overrides[0].revision_ordinal == with_override.ordinal
    assert detail.prompts[0].coordinates == [0.2, 0.3]
    assert detail.prompts[0].positive is False


def test_settings_change_records_expert_acknowledgement(seeded) -> None:
    session, video, person, _ = seeded
    root = create_selection(video.id, SelectionCreate(person_id=person.id), session)
    expert = RenderSettings(mask_margin=4, privacy_mode="expert", expert_acknowledged=True)

    updated = update_revision_settings(root.id, expert, session)

    assert updated.settings.expert_acknowledged is True
    assert updated.settings.mask_margin == 4


def test_list_selection_revisions_newest_first(seeded) -> None:
    session, video, person, _ = seeded
    root = create_selection(video.id, SelectionCreate(person_id=person.id), session)
    child = update_revision_settings(root.id, RenderSettings(blur_sigma=8), session)

    listed = list_selection_revisions(video.id, session, limit=100)

    assert [item.id for item in listed] == [child.id, root.id]


def test_unknown_revision_is_404(seeded) -> None:
    session, *_ = seeded
    with pytest.raises(HTTPException) as caught:
        get_selection_revision("missing", session)
    assert caught.value.status_code == 404
