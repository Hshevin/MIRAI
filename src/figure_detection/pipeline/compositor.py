from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class AnonymizationSettings:
    mosaic_block: int = 32
    blur_sigma: float = 16.0
    mask_margin: int = -3
    edge_smoothing: int = 4


def polygon_mask(
    shape: tuple[int, int], polygons: list[list[tuple[float, float]]]
) -> NDArray[np.uint8]:
    mask = np.zeros(shape, dtype=np.uint8)
    valid = [np.asarray(polygon, dtype=np.int32) for polygon in polygons if len(polygon) >= 3]
    if valid:
        cv2.fillPoly(mask, valid, 255)
    return mask


def adjust_mask(mask: NDArray[np.uint8], margin: int) -> NDArray[np.uint8]:
    if margin == 0:
        return mask.copy()
    size = abs(margin) * 2 + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
    operation = cv2.MORPH_DILATE if margin > 0 else cv2.MORPH_ERODE
    return cv2.morphologyEx(mask, operation, kernel)


def anonymized_background(
    image: NDArray[np.uint8], mosaic_block: int, blur_sigma: float
) -> NDArray[np.uint8]:
    height, width = image.shape[:2]
    grid_width = max(1, round(width / mosaic_block))
    grid_height = max(1, round(height / mosaic_block))
    small = cv2.resize(image, (grid_width, grid_height), interpolation=cv2.INTER_AREA)
    mosaic = cv2.resize(small, (width, height), interpolation=cv2.INTER_NEAREST)
    if blur_sigma <= 0:
        return mosaic
    return cv2.GaussianBlur(mosaic, (0, 0), sigmaX=blur_sigma, sigmaY=blur_sigma)


def composite_primary(
    image: NDArray[np.uint8],
    primary_mask: NDArray[np.uint8],
    settings: AnonymizationSettings,
) -> NDArray[np.uint8]:
    safe_mask = adjust_mask(primary_mask, settings.mask_margin)
    if settings.edge_smoothing:
        distance = cv2.distanceTransform((safe_mask > 0).astype(np.uint8), cv2.DIST_L2, 3)
        alpha = np.clip(distance / settings.edge_smoothing, 0.0, 1.0)
    else:
        alpha = (safe_mask > 0).astype(np.float32)
    background = anonymized_background(image, settings.mosaic_block, settings.blur_sigma)
    alpha = alpha[:, :, None]
    output = image.astype(np.float32) * alpha + background.astype(np.float32) * (1.0 - alpha)
    return np.clip(output, 0, 255).astype(np.uint8)
