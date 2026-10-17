"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { makeProjector } from "@/components/map/scene/coords";
import type { Camera, Floor } from "@/lib/types";

/** Each camera as a small housing at its mount height with its field of view on the floor. */
export function CameraLayer({
  floor,
  cameras,
  selectedId,
  onSelect,
}: {
  floor: Floor;
  cameras: Camera[];
  selectedId?: string | null;
  onSelect?: (camera: Camera) => void;
}) {
  const project = useMemo(() => makeProjector(floor, floor), [floor]);
  return (
    <group>
      {cameras.map((cam) => (
        <CameraMarker
          key={cam.id}
          camera={cam}
          project={project}
          selected={cam.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

function CameraMarker({
  camera,
  project,
  selected,
  onSelect,
}: {
  camera: Camera;
  project: ReturnType<typeof makeProjector>;
  selected: boolean;
  onSelect?: (camera: Camera) => void;
}) {
  const online = camera.status === "online";
  const pos = project(camera.map_x, camera.map_y);
  // Plan yaw (0 = +x, 90 = +y/north) → rotation about the scene's vertical axis.
  const yaw = (camera.orientation_deg * Math.PI) / 180;
  const fov = (camera.fov_deg * Math.PI) / 180;

  const sector = useMemo(
    () => new THREE.CircleGeometry(camera.range_m, 32, -fov / 2, fov),
    [camera.range_m, fov]
  );

  return (
    <group position={pos}>
      <mesh
        position={[0, camera.map_z, 0]}
        rotation={[0, yaw, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(camera);
        }}
      >
        <boxGeometry args={[0.6, 0.35, 0.35]} />
        <meshStandardMaterial color={online ? "#f2a93b" : "#73766d"} emissive={online ? "#5a3a0c" : "#000"} />
      </mesh>
      <mesh position={[0, camera.map_z / 2, 0]}>
        <cylinderGeometry args={[0.04, 0.04, camera.map_z, 6]} />
        <meshStandardMaterial color="#3a403b" />
      </mesh>
      {/* CircleGeometry lies in XY; tilt it flat and turn it to the camera's heading. */}
      <mesh geometry={sector} rotation={[-Math.PI / 2, 0, yaw]} position={[0, 0.04, 0]}>
        <meshBasicMaterial
          color="#f2a93b"
          transparent
          opacity={selected ? 0.16 : 0.045}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
