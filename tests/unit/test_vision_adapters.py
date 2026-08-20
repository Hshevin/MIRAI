import sys
from types import SimpleNamespace

import numpy as np
import pytest

from figure_detection.vision.adapters import BoxMotReIdEncoder, VisionDependencyError, require_cuda


def test_require_cuda_explains_driver_requirement(monkeypatch):
    monkeypatch.setitem(
        sys.modules,
        "torch",
        SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
    )

    with pytest.raises(VisionDependencyError, match="working NVIDIA driver"):
        require_cuda()


def test_require_cuda_accepts_available_device(monkeypatch):
    monkeypatch.setitem(
        sys.modules,
        "torch",
        SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True)),
    )

    require_cuda()


def test_reid_encoder_calls_boxmot_runtime_and_normalizes_embeddings():
    calls = []

    def runtime(image, *, boxes):
        calls.append((image, boxes))
        return np.asarray([[3.0, 4.0], [0.0, 2.0]], dtype=np.float32)

    encoder = BoxMotReIdEncoder.__new__(BoxMotReIdEncoder)
    encoder.model = runtime
    image = np.zeros((10, 20, 3), dtype=np.uint8)
    boxes = [(0.0, 1.0, 5.0, 8.0), (2.0, 3.0, 9.0, 10.0)]

    embeddings = encoder.embed(image, boxes)

    assert calls[0][0] is image
    np.testing.assert_array_equal(calls[0][1], np.asarray(boxes))
    np.testing.assert_allclose(embeddings, [[0.6, 0.8], [0.0, 1.0]])
