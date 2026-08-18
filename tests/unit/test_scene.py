import numpy as np

from figure_detection.pipeline.scene import SceneCutDetector


def solid(color: tuple[int, int, int]) -> np.ndarray:
    image = np.zeros((90, 160, 3), dtype=np.uint8)
    image[:] = color
    return image


def test_scene_detector_marks_first_frame_and_large_color_change() -> None:
    detector = SceneCutDetector(threshold=0.5)
    first_cut, _ = detector.is_cut(solid((0, 0, 255)))
    same_cut, _ = detector.is_cut(solid((0, 0, 255)))
    changed_cut, _ = detector.is_cut(solid((0, 255, 0)))
    assert first_cut is True
    assert same_cut is False
    assert changed_cut is True
