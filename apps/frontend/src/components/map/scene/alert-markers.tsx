"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { makeProjector } from "@/components/map/scene/coords";
import type { Alert, Floor } from "@/lib/types";

const COLOR: Record<Alert["severity"], string> = {
  low: "#a4a69c",
  medium: "#e8c547",
  high: "#f08a3c",
  critical: "#e5484d",
};

/** Active alerts as expanding rings on the floor plus a beacon line, by severity. */
export function AlertMarkers({ floor, alerts }: { floor: Floor; alerts: Alert[] }) {
  const project = useMemo(() => makeProjector(floor, floor), [floor]);
  const reduce = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  return (
    <group>
      {alerts
        .filter((a) => a.map_x != null && a.map_y != null)
        .map((a) => (
          <Marker key={a.id} position={project(a.map_x!, a.map_y!)} color={COLOR[a.severity]} animate={!reduce} />
        ))}
    </group>
  );
}

function Marker({ position, color, animate }: { position: [number, number, number]; color: string; animate: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (!animate || !ring.current || !material.current) return;
    const t = (clock.getElapsedTime() % 1.8) / 1.8;
    ring.current.scale.setScalar(1 + t * 2.4);
    material.current.opacity = 0.85 * (1 - t);
  });
  return (
    <group position={position}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[0.9, 1.15, 40]} />
        <meshBasicMaterial ref={material} color={color} transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <mesh position={[0, 3, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 6, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 6.1, 0]}>
        <sphereGeometry args={[0.28, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}
