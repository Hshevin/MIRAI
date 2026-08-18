import cv2
import numpy as np
from numpy.typing import NDArray


class SceneCutDetector:
    def __init__(self, threshold: float = 0.55) -> None:
        self.threshold = threshold
        self._previous: NDArray[np.float32] | None = None

    def reset(self) -> None:
        self._previous = None

    def score(self, image: NDArray[np.uint8]) -> float:
        small = cv2.resize(image, (160, 90), interpolation=cv2.INTER_AREA)
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        histogram = cv2.calcHist([hsv], [0, 1], None, [32, 16], [0, 180, 0, 256])
        histogram = cv2.normalize(histogram, histogram).astype(np.float32).ravel()
        if self._previous is None:
            value = 1.0
        else:
            correlation = cv2.compareHist(self._previous, histogram, cv2.HISTCMP_CORREL)
            value = float(np.clip(1.0 - correlation, 0.0, 1.0))
        self._previous = histogram
        return value

    def is_cut(self, image: NDArray[np.uint8]) -> tuple[bool, float]:
        score = self.score(image)
        return score >= self.threshold, score
