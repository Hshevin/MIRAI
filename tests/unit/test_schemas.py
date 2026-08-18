import pytest
from pydantic import ValidationError

from figure_detection.api.schemas import MaskPromptCreate, RenderSettings


def test_safe_settings_reject_positive_expansion() -> None:
    with pytest.raises(ValidationError):
        RenderSettings(mask_margin=2)


def test_acknowledged_expert_settings_allow_expansion() -> None:
    value = RenderSettings(mask_margin=2, privacy_mode="expert", expert_acknowledged=True)
    assert value.mask_margin == 2


def test_prompt_coordinates_are_normalized() -> None:
    with pytest.raises(ValidationError):
        MaskPromptCreate(timestamp_us=0, kind="point", coordinates=[1.2, 0.5])
