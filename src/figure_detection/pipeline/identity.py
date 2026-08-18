from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from figure_detection.domain.enums import MembershipStatus


@dataclass(frozen=True)
class TrackletIdentity:
    id: str
    start_us: int
    end_us: int
    embedding: NDArray[np.float32] | None


@dataclass(frozen=True)
class IdentityMembership:
    tracklet_id: str
    cluster: int
    status: MembershipStatus
    score: float
    margin: float | None


def cosine_similarity(left: NDArray[np.float32], right: NDArray[np.float32]) -> float:
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    return float(np.dot(left, right) / denominator) if denominator else 0.0


def intervals_overlap(left: TrackletIdentity, right: TrackletIdentity) -> bool:
    return left.start_us <= right.end_us and right.start_us <= left.end_us


def cluster_tracklets(
    tracklets: list[TrackletIdentity],
    confirmed_similarity: float = 0.82,
    ambiguous_similarity: float = 0.70,
    minimum_margin: float = 0.08,
) -> list[IdentityMembership]:
    clusters: list[list[TrackletIdentity]] = []
    memberships: list[IdentityMembership] = []
    for tracklet in sorted(tracklets, key=lambda item: (item.start_us, item.end_us)):
        candidates: list[tuple[float, int]] = []
        if tracklet.embedding is not None:
            for index, cluster in enumerate(clusters):
                if any(intervals_overlap(tracklet, member) for member in cluster):
                    continue
                similarities = [
                    cosine_similarity(tracklet.embedding, member.embedding)
                    for member in cluster
                    if member.embedding is not None
                ]
                if similarities:
                    candidates.append((min(similarities), index))
        candidates.sort(reverse=True)
        best_score, best_cluster = candidates[0] if candidates else (0.0, -1)
        second_score = candidates[1][0] if len(candidates) > 1 else 0.0
        margin = best_score - second_score if candidates else None
        if best_score >= confirmed_similarity and margin is not None and margin >= minimum_margin:
            status = MembershipStatus.CONFIRMED
            cluster_index = best_cluster
        elif best_score >= ambiguous_similarity:
            status = MembershipStatus.AMBIGUOUS
            cluster_index = best_cluster
        else:
            status = MembershipStatus.CONFIRMED
            cluster_index = len(clusters)
            clusters.append([])
            best_score = 1.0
            margin = None
        clusters[cluster_index].append(tracklet)
        memberships.append(
            IdentityMembership(tracklet.id, cluster_index, status, best_score, margin)
        )
    return memberships
