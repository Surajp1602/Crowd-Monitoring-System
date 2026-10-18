"""Global person identity assignment.

Today this only guarantees a *stable identity within one camera's tracker
session* — a local DeepSORT track_id gets one global_person_id UUID for as
long as that track stays alive. True cross-camera re-identification (matching
a person leaving Camera A's frame to one entering Camera B, per the platform's
"when feasible" requirement) needs an appearance-embedding gallery matched
across cameras with spatial/temporal gating, which is a substantial feature
in its own right. `Track.appearance_embedding` already exists to support it —
wiring the actual cross-camera matcher in here is the follow-up, not a
half-implemented heuristic that would silently misattribute identities.
"""

import uuid


class IdentityRegistry:
    def __init__(self) -> None:
        self._local_to_global: dict[int, uuid.UUID] = {}

    def resolve(self, local_track_id: int) -> uuid.UUID:
        global_id = self._local_to_global.get(local_track_id)
        if global_id is None:
            global_id = uuid.uuid4()
            self._local_to_global[local_track_id] = global_id
        return global_id

    def forget(self, local_track_id: int) -> None:
        self._local_to_global.pop(local_track_id, None)
