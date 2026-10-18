"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { AlertMarkers } from "@/components/map/scene/alert-markers";
import { CameraLayer } from "@/components/map/scene/cameras";
import type { SafeArea } from "@/components/map/scene/label-sprite";
import { PeopleLayer } from "@/components/map/scene/people";
import { FloorStructure } from "@/components/map/scene/structure";
import { DensityTerrain } from "@/components/map/scene/terrain";
import type { HeatmapFrame, LivePerson } from "@/lib/live-types";
import type { Alert, Camera, Floor, Zone } from "@/lib/types";

/** The slice of drei's OrbitControls the camera rig drives. */
interface OrbitControlsImpl {
  target: THREE.Vector3;
  update: () => void;
}

export type ViewPreset = "terrain" | "plan" | "low";

export interface SceneLayers {
  terrain: boolean;
  people: boolean;
  cameras: boolean;
  labels: boolean;
}

interface FacilitySceneProps {
  floor: Floor;
  floors: Floor[];
  zones: Zone[];
  cameras: Camera[];
  heatmap: HeatmapFrame | null;
  people: LivePerson[];
  alerts?: Alert[];
  preset: ViewPreset;
  layers: SceneLayers;
  selectedZoneId?: string | null;
  selectedCameraId?: string | null;
  onSelectZone?: (zone: Zone | null) => void;
  onSelectCamera?: (camera: Camera | null) => void;
  /** Canvas pixels covered by overlays at the top and bottom, kept free of labels. */
  labelSafeArea?: SafeArea;
}

const NO_INSETS: SafeArea = { top: 0, bottom: 0 };

const FOV = 38;

function presetPose(
  preset: ViewPreset,
  floor: Floor,
  aspect = 16 / 10
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const target = new THREE.Vector3(0, 0, 0);
  if (preset === "plan") {
    // Straight down, far enough that the whole floor fits the canvas in both directions.
    const t = Math.tan(((FOV / 2) * Math.PI) / 180);
    const height = Math.max(floor.depth_m / (2 * t), floor.width_m / (2 * t * aspect)) * 1.12;
    return { position: new THREE.Vector3(0, height, 0.001), target };
  }
  // On a canvas taller than wide, pull back so the floor's width still fits.
  const span = Math.max(floor.width_m, floor.depth_m) * Math.max(1, 1.2 / aspect);
  if (preset === "low") return { position: new THREE.Vector3(-span * 0.55, span * 0.18, span * 0.62), target };
  return { position: new THREE.Vector3(span * 0.35, span * 0.62, span * 0.78), target };
}

/** Eases the camera to a preset pose, then hands control back to the orbit controls. */
function CameraRig({ preset, floor }: { preset: ViewPreset; floor: Floor }) {
  const { camera, controls, size } = useThree();
  // Read when the preset or floor changes; a resize alone keeps the user's view.
  const aspect = useRef(1);
  useEffect(() => {
    aspect.current = size.width / Math.max(1, size.height);
  }, [size]);
  const goal = useRef<ReturnType<typeof presetPose> | null>(null);
  const reduce = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  useEffect(() => {
    goal.current = presetPose(preset, floor, aspect.current);
    if (reduce && controls) {
      camera.position.copy(goal.current.position);
      (controls as unknown as OrbitControlsImpl).target.copy(goal.current.target);
      goal.current = null;
    }
  }, [preset, floor, camera, controls, reduce]);

  useFrame((_, delta) => {
    const g = goal.current;
    const orbit = controls as unknown as OrbitControlsImpl | null;
    if (!g || !orbit) return;
    const k = 1 - Math.exp(-delta * 3.2);
    camera.position.lerp(g.position, k);
    orbit.target.lerp(g.target, k);
    orbit.update();
    if (camera.position.distanceTo(g.position) < 0.05) goal.current = null;
  });

  return null;
}

export function FacilityScene({
  floor,
  floors,
  zones,
  cameras,
  heatmap,
  people,
  alerts = [],
  preset,
  layers,
  selectedZoneId,
  selectedCameraId,
  onSelectZone,
  onSelectCamera,
  labelSafeArea = NO_INSETS,
}: FacilitySceneProps) {
  const occupancy = useMemo(() => new Map((heatmap?.zones ?? []).map((z) => [z.zone_id, z])), [heatmap]);
  const initial = presetPose("terrain", floor);
  const building = floors.filter((f) => f.building_id === floor.building_id);

  return (
    <Canvas
      shadows={false}
      dpr={[1, 2]}
      camera={{ position: initial.position.toArray(), fov: FOV, near: 0.5, far: 2000 }}
      gl={{ antialias: true, alpha: false }}
      onPointerMissed={() => {
        onSelectZone?.(null);
        onSelectCamera?.(null);
      }}
    >
      <color attach="background" args={["#0a0c0b"]} />
      <fog attach="fog" args={["#0a0c0b", 120, 420]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[40, 80, 30]} intensity={1.15} />
      <hemisphereLight args={["#ece8de", "#0c0e0d", 0.25]} />

      {building.map((f) => (
        <FloorStructure
          key={f.id}
          floor={f}
          center={floor}
          zones={f.id === floor.id ? zones : []}
          occupancy={occupancy}
          active={f.id === floor.id}
          showLabels={layers.labels && f.id === floor.id}
          selectedZoneId={selectedZoneId}
          onSelectZone={(z) => onSelectZone?.(z)}
          labelSafeArea={labelSafeArea}
        />
      ))}

      {layers.terrain && heatmap && heatmap.floor_id === floor.id && (
        <DensityTerrain floor={floor} heatmap={heatmap} flat={preset === "plan"} />
      )}
      {layers.people && <PeopleLayer floor={floor} people={people} />}
      <AlertMarkers floor={floor} alerts={alerts} />
      {layers.cameras && (
        <CameraLayer floor={floor} cameras={cameras} selectedId={selectedCameraId} onSelect={(c) => onSelectCamera?.(c)} />
      )}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={8}
        maxDistance={Math.max(floor.width_m, floor.depth_m) * 4}
      />
      <CameraRig preset={preset} floor={floor} />
    </Canvas>
  );
}
