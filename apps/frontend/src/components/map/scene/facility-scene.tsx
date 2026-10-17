"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { AlertMarkers } from "@/components/map/scene/alert-markers";
import { CameraLayer } from "@/components/map/scene/cameras";
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
}

function presetPose(preset: ViewPreset, floor: Floor): { position: THREE.Vector3; target: THREE.Vector3 } {
  const span = Math.max(floor.width_m, floor.depth_m);
  const target = new THREE.Vector3(0, 0, 0);
  if (preset === "plan") return { position: new THREE.Vector3(0, span * 1.25, 0.001), target };
  if (preset === "low") return { position: new THREE.Vector3(-span * 0.55, span * 0.18, span * 0.62), target };
  return { position: new THREE.Vector3(span * 0.35, span * 0.62, span * 0.78), target };
}

/** Eases the camera to a preset pose, then hands control back to the orbit controls. */
function CameraRig({ preset, floor }: { preset: ViewPreset; floor: Floor }) {
  const { camera, controls } = useThree();
  const goal = useRef<ReturnType<typeof presetPose> | null>(null);
  const reduce = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  useEffect(() => {
    goal.current = presetPose(preset, floor);
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
}: FacilitySceneProps) {
  const occupancy = useMemo(() => new Map((heatmap?.zones ?? []).map((z) => [z.zone_id, z])), [heatmap]);
  const initial = presetPose("terrain", floor);
  const building = floors.filter((f) => f.building_id === floor.building_id);

  return (
    <Canvas
      shadows={false}
      dpr={[1, 2]}
      camera={{ position: initial.position.toArray(), fov: 38, near: 0.5, far: 2000 }}
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
        maxDistance={Math.max(floor.width_m, floor.depth_m) * 3}
      />
      <CameraRig preset={preset} floor={floor} />
    </Canvas>
  );
}
