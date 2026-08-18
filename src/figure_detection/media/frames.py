from collections.abc import Iterator
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

import av
import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class DecodedFrame:
    ordinal: int
    pts: int
    duration: int | None
    time_base: Fraction
    timestamp_us: int
    is_keyframe: bool
    image: NDArray[np.uint8]


def iter_video_frames(path: Path) -> Iterator[DecodedFrame]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        fallback_pts = 0
        for ordinal, frame in enumerate(container.decode(stream)):
            time_base = Fraction(frame.time_base or stream.time_base)
            pts = frame.pts if frame.pts is not None else fallback_pts
            duration = frame.duration
            fallback_pts = pts + (duration or 1)
            yield DecodedFrame(
                ordinal=ordinal,
                pts=pts,
                duration=duration,
                time_base=time_base,
                timestamp_us=round(pts * time_base * 1_000_000),
                is_keyframe=bool(frame.key_frame),
                image=frame.to_ndarray(format="bgr24"),
            )
