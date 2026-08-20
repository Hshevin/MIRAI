import sys
from types import SimpleNamespace

import pytest

from figure_detection.vision.adapters import VisionDependencyError, require_cuda


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
