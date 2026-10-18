"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { makeProjector } from "@/components/map/scene/coords";
import type { LivePerson } from "@/lib/live-types";
import type { Floor } from "@/lib/types";

const MAX_PEOPLE = 1500;
const CALM = new THREE.Color("#ece8de");
const BRISK = new THREE.Color("#f2a93b");
const RUNNING = new THREE.Color("#e5484d");

interface Smoothed {
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
}

/**
 * Every tracked person as an instanced capsule. Positions arrive at 4 Hz; each frame
 * eases toward the latest one so motion reads as walking, not teleporting.
 */
export function PeopleLayer({ floor, people }: { floor: Floor; people: LivePerson[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const state = useRef(new Map<string, Smoothed>());
  const project = useMemo(() => makeProjector(floor, floor), [floor]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const next = new Map<string, Smoothed>();
    for (const p of people) {
      const key = `${p.camera_id}:${p.track_id}`;
      const prev = state.current.get(key);
      next.set(key, prev ? { ...prev, tx: p.x, ty: p.y, speed: p.speed_mps } : { x: p.x, y: p.y, tx: p.x, ty: p.y, speed: p.speed_mps });
    }
    state.current = next;
  }, [people]);

  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const k = Math.min(1, delta * 5);
    let i = 0;
    for (const s of state.current.values()) {
      if (i >= MAX_PEOPLE) break;
      s.x += (s.tx - s.x) * k;
      s.y += (s.ty - s.y) * k;
      const [x, , z] = project(s.x, s.y);
      dummy.position.set(x, 0.85, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, s.speed >= 3 ? RUNNING : s.speed >= 2 ? BRISK : CALM);
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_PEOPLE]} castShadow frustumCulled={false}>
      <capsuleGeometry args={[0.2, 1.3, 4, 8]} />
      <meshStandardMaterial roughness={0.6} />
    </instancedMesh>
  );
}
