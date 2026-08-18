import numpy as np

from figure_detection.domain.enums import MembershipStatus
from figure_detection.pipeline.identity import TrackletIdentity, cluster_tracklets


def embedding(*values: float) -> np.ndarray:
    vector = np.asarray(values, dtype=np.float32)
    return vector / np.linalg.norm(vector)


def test_separated_matching_tracklets_merge() -> None:
    tracklets = [
        TrackletIdentity("a", 0, 10, embedding(1, 0)),
        TrackletIdentity("b", 20, 30, embedding(1, 0)),
    ]
    result = cluster_tracklets(tracklets)
    assert result[0].cluster == result[1].cluster
    assert result[1].status == MembershipStatus.CONFIRMED


def test_overlapping_tracklets_never_merge() -> None:
    tracklets = [
        TrackletIdentity("person", 0, 20, embedding(1, 0)),
        TrackletIdentity("reflection", 10, 30, embedding(1, 0)),
    ]
    result = cluster_tracklets(tracklets)
    assert result[0].cluster != result[1].cluster


def test_low_similarity_match_is_ambiguous() -> None:
    tracklets = [
        TrackletIdentity("a", 0, 10, embedding(1, 0)),
        TrackletIdentity("b", 20, 30, embedding(0.75, 0.66)),
    ]
    result = cluster_tracklets(tracklets)
    assert result[1].status == MembershipStatus.AMBIGUOUS
