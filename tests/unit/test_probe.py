from figure_detection.media.probe import _duration_us


def test_duration_prefers_video_stream() -> None:
    assert _duration_us({"duration": "1.25"}, {"format": {"duration": "2.0"}}) == 1_250_000


def test_duration_falls_back_to_container() -> None:
    assert _duration_us({}, {"format": {"duration": "2.5"}}) == 2_500_000
