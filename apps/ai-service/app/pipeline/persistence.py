import uuid
from datetime import datetime

from sqlalchemy import select

from common.enums import TrackStatus
from common.models import DetectionFrame, Track, TrackPoint

from app.db.session import session_scope
from app.pipeline.analysis import PersonObservation


async def persist_detection_frame(
    camera_id: uuid.UUID,
    captured_at: datetime,
    person_count: int,
    density_value: float,
    avg_confidence: float,
    inference_ms: float,
    boxes: list[dict],
) -> None:
    async with session_scope() as db:
        db.add(
            DetectionFrame(
                camera_id=camera_id,
                captured_at=captured_at,
                person_count=person_count,
                density_value=density_value,
                avg_confidence=avg_confidence,
                inference_ms=inference_ms,
                boxes=boxes,
            )
        )
        await db.commit()


async def upsert_tracks(camera_id: uuid.UUID, observations: list[PersonObservation], now: datetime) -> None:
    """Creates/updates one Track row per active local track and appends a TrackPoint
    trajectory sample for each. Called on the pipeline's DB_PERSIST_INTERVAL_S cadence,
    not every frame, so Postgres sees a steady, bounded write rate regardless of FPS."""
    if not observations:
        return

    async with session_scope() as db:
        local_ids = [o.person.track_id for o in observations]
        stmt = select(Track).where(
            Track.camera_id == camera_id,
            Track.local_track_id.in_(local_ids),
            Track.status == TrackStatus.ACTIVE,
        )
        existing = {t.local_track_id: t for t in (await db.execute(stmt)).scalars().all()}

        for obs in observations:
            k = obs.kinematics
            track = existing.get(obs.person.track_id)
            if track is None:
                track = Track(
                    camera_id=camera_id,
                    local_track_id=obs.person.track_id,
                    global_person_id=obs.global_id,
                    status=TrackStatus.ACTIVE,
                    first_seen_at=now,
                    last_seen_at=now,
                )
                db.add(track)
            track.last_seen_at = now
            track.last_map_x = obs.map_x
            track.last_map_y = obs.map_y
            track.last_speed_mps = k.speed_mps
            track.last_direction_deg = k.direction_deg
            track.dwell_time_s = k.dwell_time_s
            await db.flush()
            db.add(
                TrackPoint(
                    track_id=track.id,
                    ts=now,
                    map_x=obs.map_x,
                    map_y=obs.map_y,
                    bbox=[obs.person.x1, obs.person.y1, obs.person.x2, obs.person.y2],
                    speed_mps=k.speed_mps,
                    direction_deg=k.direction_deg,
                )
            )
        await db.commit()


async def mark_tracks_lost(camera_id: uuid.UUID, lost_local_track_ids: list[int], now: datetime) -> None:
    if not lost_local_track_ids:
        return
    async with session_scope() as db:
        stmt = select(Track).where(
            Track.camera_id == camera_id,
            Track.local_track_id.in_(lost_local_track_ids),
            Track.status == TrackStatus.ACTIVE,
        )
        for track in (await db.execute(stmt)).scalars().all():
            track.status = TrackStatus.LOST
            track.last_seen_at = now
        await db.commit()
