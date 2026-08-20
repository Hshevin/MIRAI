from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from figure_detection.vision.types import Embedding, PersonDetection, TrackedPerson


class VisionDependencyError(RuntimeError):
    pass


def require_cuda() -> None:
    """Fail before model setup with an actionable GPU runtime error."""
    try:
        import torch
    except ImportError as exc:
        raise VisionDependencyError(
            "PyTorch is unavailable. Install the vision environment with `uv sync --extra vision`."
        ) from exc
    if not torch.cuda.is_available():
        raise VisionDependencyError(
            "CUDA is unavailable. People analysis requires a CUDA-capable NVIDIA GPU and a "
            "working NVIDIA driver. Verify that `nvidia-smi` succeeds, then restart the worker."
        )


def _dependency_error(package: str, exc: ImportError) -> VisionDependencyError:
    missing = getattr(exc, "name", None)
    if missing == package or (missing and missing.startswith(f"{package}.")):
        detail = f"missing module `{missing}`"
    else:
        detail = str(exc)
    return VisionDependencyError(
        f"{package} could not be imported ({detail}). Re-run `uv sync --extra vision`; "
        "if it is already installed, the installed package may be incompatible."
    )


class PersonDetector(Protocol):
    def detect(self, image: NDArray[np.uint8]) -> list[PersonDetection]: ...


class PersonTracker(Protocol):
    def reset(self) -> None: ...

    def update(
        self, image: NDArray[np.uint8], detections: Sequence[PersonDetection]
    ) -> list[TrackedPerson]: ...


class ReIdEncoder(Protocol):
    def embed(
        self, image: NDArray[np.uint8], boxes: Sequence[tuple[float, float, float, float]]
    ) -> list[Embedding]: ...


class PrimaryMaskRefiner(Protocol):
    def refine(
        self,
        image: NDArray[np.uint8],
        box: tuple[float, float, float, float],
        points: Sequence[tuple[float, float]],
        labels: Sequence[int],
        threshold: float,
    ) -> NDArray[np.uint8] | None: ...


class UltralyticsPersonDetector:
    def __init__(self, model_name: str = "yolo26l-seg.pt", image_size: int = 960) -> None:
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise _dependency_error("ultralytics", exc) from exc
        self.model = YOLO(model_name)
        self.image_size = image_size

    def detect(self, image: NDArray[np.uint8]) -> list[PersonDetection]:
        result = self.model.predict(
            image, classes=[0], conf=0.10, iou=0.70, imgsz=self.image_size, verbose=False
        )[0]
        polygons = result.masks.xy if result.masks is not None else []
        detections: list[PersonDetection] = []
        for index, box in enumerate(result.boxes):
            xyxy = tuple(float(value) for value in box.xyxy[0].tolist())
            polygon = []
            if index < len(polygons):
                polygon = [(float(x), float(y)) for x, y in polygons[index].tolist()]
            detections.append(
                PersonDetection(box=xyxy, confidence=float(box.conf[0]), polygon=polygon)
            )
        return detections


class BoxMotPersonTracker:
    def __init__(self, reid_weights: str = "osnet_x1_0_msmt17.pt") -> None:
        try:
            from boxmot.trackers.registry import create_tracker
        except ImportError as exc:
            raise _dependency_error("boxmot", exc) from exc
        require_cuda()
        self._create_tracker = create_tracker
        self.reid_weights = Path(reid_weights)
        self._tracker = self._new_tracker()

    def _new_tracker(self):
        return self._create_tracker(
            "botsort", reid_weights=self.reid_weights, device="cuda:0", half=True
        )

    def reset(self) -> None:
        self._tracker = self._new_tracker()

    def update(
        self, image: NDArray[np.uint8], detections: Sequence[PersonDetection]
    ) -> list[TrackedPerson]:
        if not detections:
            self._tracker.update(np.empty((0, 6), dtype=np.float32), image)
            return []
        rows = np.asarray(
            [[*item.box, item.confidence, 0.0] for item in detections], dtype=np.float32
        )
        tracks = np.asarray(self._tracker.update(rows, image))
        output: list[TrackedPerson] = []
        for row in tracks:
            tracker_id = int(row[4])
            det_index = int(row[7]) if len(row) > 7 else _nearest_detection(row[:4], detections)
            if 0 <= det_index < len(detections):
                output.append(TrackedPerson(tracker_id, detections[det_index]))
        return output


def _nearest_detection(box: Sequence[float], detections: Sequence[PersonDetection]) -> int:
    target = np.asarray(box, dtype=np.float32)
    distances = [np.square(target - np.asarray(item.box)).sum() for item in detections]
    return int(np.argmin(distances))


class BoxMotReIdEncoder:
    def __init__(self, weights: str = "osnet_x1_0_msmt17.pt") -> None:
        try:
            from boxmot.reid.core import ReID
        except ImportError as exc:
            raise _dependency_error("boxmot", exc) from exc
        require_cuda()
        self.model = ReID(weights=weights, device="cuda:0", half=True)

    def embed(
        self, image: NDArray[np.uint8], boxes: Sequence[tuple[float, float, float, float]]
    ) -> list[Embedding]:
        if not boxes:
            return []
        values = np.asarray(self.model(image, boxes=np.asarray(boxes)), dtype=np.float32)
        norms = np.linalg.norm(values, axis=1, keepdims=True).clip(min=1e-12)
        return [row for row in values / norms]
