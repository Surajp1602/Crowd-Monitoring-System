from dataclasses import dataclass


@dataclass
class TrackedPerson:
    track_id: int
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    confirmed: bool = True
