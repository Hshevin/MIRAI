from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class PersonDetection:
    box: tuple[float, float, float, float]
    confidence: float
    polygon: list[tuple[float, float]] = field(default_factory=list)


@dataclass(frozen=True)
class TrackedPerson:
    tracker_id: int
    detection: PersonDetection


Embedding = NDArray[np.float32]
