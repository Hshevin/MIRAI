import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from figure_detection.domain.enums import MembershipStatus
from figure_detection.storage.models import (
    IdentityOverride,
    MaskPrompt,
    PersonMembership,
    SelectionRevision,
)


@dataclass(frozen=True)
class EffectiveOverride:
    tracklet_id: str
    start_us: int
    end_us: int
    included: bool


@dataclass(frozen=True)
class EffectivePrompt:
    timestamp_us: int
    kind: str
    positive: bool
    coordinates: list[float]


@dataclass(frozen=True)
class EffectiveSelection:
    revision: SelectionRevision
    confirmed_tracklets: frozenset[str]
    overrides: tuple[EffectiveOverride, ...]
    prompts: tuple[EffectivePrompt, ...]

    def includes(self, tracklet_id: str, timestamp_us: int) -> bool:
        included = tracklet_id in self.confirmed_tracklets
        for override in self.overrides:
            if (
                override.tracklet_id == tracklet_id
                and override.start_us <= timestamp_us <= override.end_us
            ):
                included = override.included
        return included


def revision_chain(session: Session, leaf: SelectionRevision) -> list[SelectionRevision]:
    chain = [leaf]
    current = leaf
    seen = {leaf.id}
    while current.parent_id:
        current = session.get(SelectionRevision, current.parent_id)
        if current is None or current.id in seen:
            raise ValueError("Selection revision chain is invalid")
        seen.add(current.id)
        chain.append(current)
    chain.reverse()
    return chain


def resolve_selection(session: Session, revision_id: str) -> EffectiveSelection:
    revision = session.get(SelectionRevision, revision_id)
    if revision is None:
        raise LookupError("Selection revision not found")
    confirmed = frozenset(
        session.scalars(
            select(PersonMembership.tracklet_id).where(
                PersonMembership.person_id == revision.person_id,
                PersonMembership.status == MembershipStatus.CONFIRMED,
            )
        ).all()
    )
    overrides: list[EffectiveOverride] = []
    prompts: list[EffectivePrompt] = []
    for item in revision_chain(session, revision):
        overrides.extend(
            EffectiveOverride(row.tracklet_id, row.start_us, row.end_us, row.decision == "include")
            for row in session.scalars(
                select(IdentityOverride).where(IdentityOverride.revision_id == item.id)
            )
        )
        prompts.extend(
            EffectivePrompt(
                row.timestamp_us,
                row.kind,
                row.positive,
                json.loads(row.coordinates_json),
            )
            for row in session.scalars(select(MaskPrompt).where(MaskPrompt.revision_id == item.id))
        )
    return EffectiveSelection(revision, confirmed, tuple(overrides), tuple(prompts))
