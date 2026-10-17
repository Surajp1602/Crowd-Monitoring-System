import type { Floor } from "@/lib/types";

/** Vertical spacing between stacked floors in the building view, in meters. */
export const STOREY_HEIGHT = 7;

/** Height of the density terrain per person/m². 5 p/m² rises 3.5 m: dramatic, never absurd. */
export const TERRAIN_SCALE = 0.7;

/**
 * Floor plan meters → scene. Plan x stays x, plan y (north) becomes -z, each storey is
 * lifted by its level, and the selected floor's centre sits at the origin.
 */
export function makeProjector(floor: Floor, center: Floor) {
  const cx = center.width_m / 2;
  const cy = center.depth_m / 2;
  const base = (floor.level_index - center.level_index) * STOREY_HEIGHT;
  return (x: number, y: number, h = 0): [number, number, number] => [x - cx, base + h, -(y - cy)];
}
