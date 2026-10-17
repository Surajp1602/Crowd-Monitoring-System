"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { makeProjector } from "@/components/map/scene/coords";
import { LabelSprite } from "@/components/map/scene/label-sprite";
import type { ZoneOccupancy } from "@/lib/live-types";
import { densityColor, densityLevel } from "@/lib/isolines";
import type { Floor, FloorLayout, Zone } from "@/lib/types";

const WALL_COLOR = new THREE.Color("#262b27");
const EDGE_COLOR = new THREE.Color("#ece8de");

/** The floor slab, extruded walls and zone footprints of one storey. */
export function FloorStructure({
  floor,
  center,
  zones,
  occupancy,
  active,
  showLabels,
  selectedZoneId,
  onSelectZone,
}: {
  floor: Floor;
  center: Floor;
  zones: Zone[];
  occupancy?: Map<string, ZoneOccupancy>;
  active: boolean;
  showLabels: boolean;
  selectedZoneId?: string | null;
  onSelectZone?: (zone: Zone) => void;
}) {
  const project = useMemo(() => makeProjector(floor, center), [floor, center]);
  const layout = (floor.layout ?? {}) as FloorLayout;
  const wallHeight = layout.wall_height_m ?? 4;

  const walls = useMemo(
    () =>
      (layout.walls ?? []).map((w) => {
        const [x1, , z1] = project(w.x1, w.y1);
        const [x2, , z2] = project(w.x2, w.y2);
        const length = Math.hypot(x2 - x1, z2 - z1);
        return {
          position: [(x1 + x2) / 2, project(0, 0)[1] + wallHeight / 2, (z1 + z2) / 2] as [number, number, number],
          rotation: -Math.atan2(z2 - z1, x2 - x1),
          length,
        };
      }),
    [layout.walls, project, wallHeight]
  );

  const slab = project(floor.width_m / 2, floor.depth_m / 2, -0.06);

  return (
    <group>
      <mesh position={slab} receiveShadow>
        <boxGeometry args={[floor.width_m, 0.12, floor.depth_m]} />
        <meshStandardMaterial
          color={active ? "#111412" : "#0e100f"}
          transparent={!active}
          opacity={active ? 1 : 0.35}
          roughness={0.95}
        />
      </mesh>
      {active && (
        <gridHelper
          args={[Math.max(floor.width_m, floor.depth_m), Math.max(floor.width_m, floor.depth_m) / 5, "#232825", "#1a1e1b"]}
          position={project(floor.width_m / 2, floor.depth_m / 2, 0.005)}
        />
      )}

      {walls.map((w, i) =>
        active ? (
          <mesh key={i} position={w.position} rotation={[0, w.rotation, 0]} castShadow>
            <boxGeometry args={[w.length, wallHeight, 0.18]} />
            <meshStandardMaterial color={WALL_COLOR} transparent opacity={0.72} roughness={0.8} />
          </mesh>
        ) : (
          <lineSegments key={i} position={w.position} rotation={[0, w.rotation, 0]}>
            <edgesGeometry args={[new THREE.BoxGeometry(w.length, 0.05, 0.05)]} />
            <lineBasicMaterial color={EDGE_COLOR} transparent opacity={0.18} />
          </lineSegments>
        )
      )}

      {active &&
        zones.map((zone) => (
          <ZoneFootprint
            key={zone.id}
            zone={zone}
            project={project}
            occupancy={occupancy?.get(zone.id)}
            selected={zone.id === selectedZoneId}
            showLabel={showLabels}
            onSelect={onSelectZone}
          />
        ))}
    </group>
  );
}

function ZoneFootprint({
  zone,
  project,
  occupancy,
  selected,
  showLabel,
  onSelect,
}: {
  zone: Zone;
  project: ReturnType<typeof makeProjector>;
  occupancy?: ZoneOccupancy;
  selected: boolean;
  showLabel: boolean;
  onSelect?: (zone: Zone) => void;
}) {
  const { shape, outline, labelAt } = useMemo(() => {
    // Shapes live in the XY plane; we rotate them flat, so y must be the plan's -z.
    const pts = zone.polygon.map((p) => {
      const [x, , z] = project(p.x, p.y);
      return new THREE.Vector2(x, -z);
    });
    const s = new THREE.Shape(pts);
    const outlinePts = [...zone.polygon, zone.polygon[0]!].map((p) => new THREE.Vector3(...project(p.x, p.y, 0.03)));
    const minX = Math.min(...zone.polygon.map((p) => p.x));
    const maxY = Math.max(...zone.polygon.map((p) => p.y));
    return {
      shape: s,
      outline: new THREE.BufferGeometry().setFromPoints(outlinePts),
      labelAt: project(minX + 0.6, maxY - 0.6, 0.6),
    };
  }, [zone.polygon, project]);

  const base = project(0, 0)[1];
  const level = occupancy ? densityLevel(occupancy.density) : null;
  const over = occupancy?.capacity_threshold != null && occupancy.count > occupancy.capacity_threshold;
  const tint = zone.is_restricted ? "#e5484d" : over ? "#e5484d" : "#ece8de";

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, base + 0.015, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(zone);
        }}
      >
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial
          color={tint}
          transparent
          opacity={selected ? 0.14 : zone.is_restricted ? 0.08 : 0.025}
          depthWrite={false}
        />
      </mesh>
      <lineLoop geometry={outline}>
        <lineBasicMaterial color={selected ? "#f2a93b" : tint} transparent opacity={selected ? 1 : zone.is_restricted ? 0.6 : 0.28} />
      </lineLoop>
      {showLabel && (
        <LabelSprite
          position={labelAt}
          text={zone.name}
          accent={occupancy && occupancy.count > 0 ? String(occupancy.count) : undefined}
          color={zone.is_restricted ? "#e5484d" : "#a4a69c"}
          accentColor={over ? "#e5484d" : level ? densityHex(occupancy!.density) : "#ece8de"}
        />
      )}
    </group>
  );
}

function densityHex(value: number) {
  const [r, g, b] = densityColor(Math.max(value, 0.6));
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}
