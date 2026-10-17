from dataclasses import dataclass


@dataclass
class Detection:
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    class_id: int = 0
    """COCO class id. 0 is a person; the bag classes feed abandoned-object detection."""
