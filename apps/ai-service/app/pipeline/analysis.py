"""Pure per-frame analysis: tracked people in pixel space -> floor positions, motion,
identity, zone membership and density. No I/O, so it is unit-tested directly and is
identical for real cameras and the simulator.
"""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from common.schemas import BoxDTO

from app.density.estimator import estimate_density
from app.density.geometry import project_to_floor
from app.pipeline.context import CameraContext, ZoneInfo
from app.tracking.identity import IdentityRegistry
from app.tracking.kinematics import KinematicsTracker, TrackKinematics
from app.tracking.types import TrackedPerson


@dataclass
class PersonObservation:
    person: TrackedPerson
    global_id: uuid.UUID
    map_x: float
    map_y: float
    kinematics: TrackKinematics
    zone: ZoneInfo | None


@dataclass
class FrameAnalysis:
    captured_at: datetime
    ts: float
    frame_width: int
    frame_height: int
    observations: list[PersonObservation]
    density_value: float
    avg_confidence: float
    inference_ms: float
    zone_counts: dict[uuid.UUID, int] = field(default_factory=dict)

    @property
    def person_count(self) -> int:
        return len(self.observations)

    @property
    def active_track_ids(self) -> set[int]:
        return {o.person.track_id for o in self.observations}

    def boxes(self) -> list[BoxDTO]:
        w, h = self.frame_width or 1, self.frame_height or 1
        return [
            BoxDTO(
                track_id=o.person.track_id,
                global_person_id=str(o.global_id),
                x1=o.person.x1 / w,
                y1=o.person.y1 / h,
                x2=o.person.x2 / w,
                y2=o.person.y2 / h,
                confidence=o.person.confidence,
            )
            for o in self.observations
        ]


class FrameAnalyzer:
    """Owns the per-camera state that must persist between frames (kinematics and
    identity), keyed by the tracker's local track id."""

    def __init__(self, context: CameraContext) -> None:
        self.context = context
        self.geometry = context.geometry
        self.kinematics = KinematicsTracker()
        self.identity = IdentityRegistry()

    def analyze(
        self,
        people: list[TrackedPerson],
        frame_width: int,
        frame_height: int,
        ts: float,
        captured_at: datetime,
        avg_confidence: float,
        inference_ms: float,
    ) -> FrameAnalysis:
        observations: list[PersonObservation] = []
        zone_counts: dict[uuid.UUID, int] = {}
        for person in people:
            map_x, map_y = project_to_floor(
                self.geometry, (person.x1, person.y1, person.x2, person.y2), frame_width, frame_height
            )
            kinematics = self.kinematics.update(person.track_id, ts, map_x, map_y)
            zone = self.context.zone_at(map_x, map_y)
            if zone is not None:
                zone_counts[zone.id] = zone_counts.get(zone.id, 0) + 1
            observations.append(
                PersonObservation(
                    person=person,
                    global_id=self.identity.resolve(person.track_id),
                    map_x=map_x,
                    map_y=map_y,
                    kinematics=kinematics,
                    zone=zone,
                )
            )

        analysis = FrameAnalysis(
            captured_at=captured_at,
            ts=ts,
            frame_width=frame_width,
            frame_height=frame_height,
            observations=observations,
            density_value=estimate_density(len(people), self.geometry),
            avg_confidence=avg_confidence,
            inference_ms=inference_ms,
            zone_counts=zone_counts,
        )
        self.kinematics.drop_stale(analysis.active_track_ids, ts)
        return analysis

    def forget(self, local_track_ids: set[int]) -> None:
        for track_id in local_track_ids:
            self.identity.forget(track_id)
