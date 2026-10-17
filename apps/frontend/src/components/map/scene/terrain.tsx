"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TERRAIN_SCALE, makeProjector } from "@/components/map/scene/coords";
import { ISOLINE_LEVELS, decodeHeatmap, densityColor, isolines } from "@/lib/isolines";
import type { HeatmapFrame } from "@/lib/live-types";
import type { Floor } from "@/lib/types";

const INK = new THREE.Color("#111412");
const MAX_HEIGHT = 4.5;

/**
 * The density field as terrain: one vertex per heatmap cell, raised by people/m² and
 * tinted along the density scale, with isolines floating at each contour's height.
 * Heights ease toward each new 1 Hz frame so the landscape breathes instead of jumping.
 */
export function DensityTerrain({ floor, heatmap, flat }: { floor: Floor; heatmap: HeatmapFrame; flat: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const target = useRef<Float32Array | null>(null);
  const current = useRef<Float32Array | null>(null);

  const { rows, cols, resolution_m: res } = heatmap;
  const project = useMemo(() => makeProjector(floor, floor), [floor]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(cols * res, rows * res, cols - 1, rows - 1);
    geo.rotateX(-Math.PI / 2);
    const [x0, , z0] = project((cols * res) / 2, (rows * res) / 2);
    geo.translate(x0, 0, z0);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(rows * cols * 3), 3));
    return geo;
  }, [rows, cols, res, project]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const grid = decodeHeatmap(heatmap);
    // PlaneGeometry vertex rows run north → south; heatmap rows run south → north.
    const reordered = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      reordered.set(grid.subarray(r * cols, (r + 1) * cols), (rows - 1 - r) * cols);
    }
    target.current = reordered;
    if (!current.current || current.current.length !== reordered.length) {
      current.current = reordered.slice();
    }

    const lines = linesRef.current;
    if (lines) {
      const positions: number[] = [];
      const colors: number[] = [];
      for (const level of ISOLINE_LEVELS) {
        const h = flat ? 0.05 : Math.min(MAX_HEIGHT, level * TERRAIN_SCALE) + 0.04;
        const [cr, cg, cb] = level >= 3.5 ? densityColor(level).map((v) => v / 255) : [0.93, 0.91, 0.87];
        for (const [x1, y1, x2, y2] of isolines(grid, rows, cols, res, level)) {
          positions.push(...project(x1, y1, h), ...project(x2, y2, h));
          colors.push(cr!, cg!, cb!, cr!, cg!, cb!);
        }
      }
      const geo = lines.geometry;
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.computeBoundingSphere();
    }
  }, [heatmap, rows, cols, res, project, flat]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const tgt = target.current;
    const cur = current.current;
    if (!mesh || !tgt || !cur) return;
    const k = Math.min(1, delta * 3);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const col = geometry.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    for (let i = 0; i < cur.length; i++) {
      const v = (cur[i]! += (tgt[i]! - cur[i]!) * k);
      pos.setY(i, flat ? 0.02 : Math.min(MAX_HEIGHT, v * TERRAIN_SCALE) + 0.02);
      if (v < 0.03) {
        col.setXYZ(i, INK.r, INK.g, INK.b);
      } else {
        const [r, g, b] = densityColor(v);
        c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        const t = Math.min(1, (v - 0.03) / 0.6);
        col.setXYZ(i, INK.r + (c.r - INK.r) * (0.25 + 0.75 * t), INK.g + (c.g - INK.g) * (0.25 + 0.75 * t), INK.b + (c.b - INK.b) * (0.25 + 0.75 * t));
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return (
    <group>
      <mesh ref={meshRef} geometry={geometry}>
        <meshStandardMaterial vertexColors transparent opacity={0.88} roughness={0.55} metalness={0.05} depthWrite={false} />
      </mesh>
      <lineSegments ref={linesRef}>
        <bufferGeometry />
        <lineBasicMaterial vertexColors transparent opacity={0.85} />
      </lineSegments>
    </group>
  );
}
