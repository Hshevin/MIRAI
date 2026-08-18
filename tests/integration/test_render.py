import json
import subprocess
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from figure_detection.domain.enums import MembershipStatus
from figure_detection.media.frames import iter_video_frames
from figure_detection.pipeline.render import render_video
from figure_detection.storage.database import Base
from figure_detection.storage.models import (
    Detection,
    Frame,
    GlobalPerson,
    PersonMembership,
    SelectionRevision,
    Shot,
    Tracklet,
    Video,
)


def test_render_creates_valid_mp4(tmp_path: Path) -> None:
    source = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x90:rate=5:duration=1",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        check=True,
    )
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        video = Video(
            original_name="source.mp4",
            source_path=str(source),
            sha256="0" * 64,
            size_bytes=source.stat().st_size,
            width=160,
            height=90,
            duration_us=1_000_000,
            video_codec="h264",
            has_audio=False,
        )
        session.add(video)
        session.flush()
        decoded_frames = list(iter_video_frames(source))
        shot = Shot(
            video_id=video.id,
            ordinal=0,
            start_pts=decoded_frames[0].pts,
            end_pts=decoded_frames[-1].pts,
            time_base_num=decoded_frames[0].time_base.numerator,
            time_base_den=decoded_frames[0].time_base.denominator,
        )
        session.add(shot)
        session.flush()
        tracklet = Tracklet(
            video_id=video.id,
            shot_id=shot.id,
            tracker_id=1,
            start_us=0,
            end_us=1_000_000,
            detected_frames=len(decoded_frames),
            mean_confidence=0.99,
        )
        session.add(tracklet)
        session.flush()
        for decoded in decoded_frames:
            frame = Frame(
                video_id=video.id,
                shot_id=shot.id,
                ordinal=decoded.ordinal,
                pts=decoded.pts,
                duration=decoded.duration,
                time_base_num=decoded.time_base.numerator,
                time_base_den=decoded.time_base.denominator,
                timestamp_us=decoded.timestamp_us,
            )
            session.add(frame)
            session.flush()
            session.add(
                Detection(
                    frame_id=frame.id,
                    tracklet_id=tracklet.id,
                    x1=40,
                    y1=10,
                    x2=120,
                    y2=80,
                    confidence=0.99,
                    mask_polygon_json=json.dumps([[40, 10], [120, 10], [120, 80], [40, 80]]),
                )
            )
        person = GlobalPerson(video_id=video.id, display_label="P001")
        session.add(person)
        session.flush()
        session.add(
            PersonMembership(
                person_id=person.id,
                tracklet_id=tracklet.id,
                status=MembershipStatus.CONFIRMED,
                association_score=1.0,
            )
        )
        revision = SelectionRevision(
            video_id=video.id,
            person_id=person.id,
            ordinal=1,
            settings_json="{}",
        )
        session.add(revision)
        session.commit()
        artifact = render_video(session, video, revision.id)
        assert artifact.valid is True
        assert Path(artifact.path).is_file()
        assert artifact.size_bytes > 0
