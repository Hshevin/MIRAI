import numpy as np

from figure_detection.pipeline.compositor import (
    AnonymizationSettings,
    anonymized_background,
    composite_primary,
)


def test_clear_pixels_are_limited_to_mask() -> None:
    image = np.zeros((64, 64, 3), dtype=np.uint8)
    image[:, :, 1] = np.arange(64, dtype=np.uint8)[None, :]
    mask = np.zeros((64, 64), dtype=np.uint8)
    mask[20:44, 20:44] = 255
    output = composite_primary(
        image,
        mask,
        AnonymizationSettings(mosaic_block=16, blur_sigma=8, mask_margin=-2, edge_smoothing=0),
    )
    anonymized = anonymized_background(image, 16, 8)
    outside = np.ones((64, 64), dtype=bool)
    outside[22:42, 22:42] = False
    assert np.array_equal(output[outside], anonymized[outside])
