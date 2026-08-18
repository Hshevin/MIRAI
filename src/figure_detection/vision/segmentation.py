from collections.abc import Sequence
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from figure_detection.vision.adapters import VisionDependencyError


class Sam2MaskRefiner:
    """High-detail per-frame SAM 2 refinement with conservative score rejection.

    Video-memory propagation is intentionally isolated behind this adapter so the
    renderer can retain a safe coarse-mask fallback when weights are unavailable.
    """

    def __init__(self, checkpoint: Path, config: str) -> None:
        try:
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
        except ImportError as exc:
            raise VisionDependencyError(
                "Install the vision environment with `uv sync --extra vision`"
            ) from exc
        if not checkpoint.is_file():
            raise FileNotFoundError(f"SAM 2 checkpoint not found: {checkpoint}")
        model = build_sam2(config, str(checkpoint), device="cuda")
        self.predictor = SAM2ImagePredictor(model)

    def refine(
        self,
        image: NDArray[np.uint8],
        box: tuple[float, float, float, float],
        points: Sequence[tuple[float, float]],
        labels: Sequence[int],
        threshold: float,
    ) -> NDArray[np.uint8] | None:
        self.predictor.set_image(image[:, :, ::-1])
        point_array = np.asarray(points, dtype=np.float32) if points else None
        label_array = np.asarray(labels, dtype=np.int32) if labels else None
        masks, scores, _ = self.predictor.predict(
            point_coords=point_array,
            point_labels=label_array,
            box=np.asarray(box, dtype=np.float32),
            multimask_output=False,
        )
        if not len(scores) or float(scores[0]) < threshold:
            return None
        return (masks[0] > 0).astype(np.uint8) * 255
