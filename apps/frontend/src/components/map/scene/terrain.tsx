"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TERRAIN_SCALE, makeProjector } from "@/components/map/scene/coords";
import {
  BUSY_LEVEL,
  ISOLINE_LEVELS,
  SUPPLEMENTARY_LEVEL,
  bandOf,
  decodeHeatmap,
  densityColor,
  isolines,
} from "@/lib/isolines";
import type { HeatmapFrame } from "@/lib/live-types";
import type { Floor } from "@/lib/types";

const INK = new THREE.Color("#111412");
const PAPER = new THREE.Color("#ece8de");
const MAX_HEIGHT = 4.5;
const LEVELS = [SUPPLEMENTARY_LEVEL, ...ISOLINE_LEVELS];
/** Contours are redrawn from the easing surface at this rate, so they ride the ground. */
const CONTOUR_HZ = 12;

function heightOf(v: number, flat: boolean) {
  return flat ? 0 : Math.min(MAX_HEIGHT, v * TERRAIN_SCALE);
}

/** Terrace tints, one per band: ink lifting toward paper, busy bands taking severity. */
const TERRACES: THREE.Color[] = [INK.clone()].concat(
  LEVELS.map((level, i) => {
    if (level >= BUSY_LEVEL) {
      const [r, g, b] = densityColor(level);
      return INK.clone().lerp(new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace), 0.42);
    }
    return INK.clone().lerp(PAPER, 0.1 + i * 0.06);
  })
);

/** Contour colours, pre-blended over ink since line vertex colours carry no alpha. */
const CONTOURS: THREE.Color[] = LEVELS.map((level) => {
  if (level >= BUSY_LEVEL) {
    const [r, g, b] = densityColor(level);
    return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  }
  return INK.clone().lerp(PAPER, level === SUPPLEMENTARY_LEVEL ? 0.5 : Math.min(1, 0.7 + level * 0.1));
});

/**
 * The density field as terrain: one vertex per heatmap cell, raised by people/m² and
 * shaded in flat terraces between the isolines, with each contour drawn as a hairline
 * on the surface. Heights ease toward each new 1 Hz frame so the landscape breathes
 * instead of jumping, and the contours are traced from the eased surface so they never
 * float above or sink beneath it.
 */
export function DensityTerrain({ floor, heatmap, flat }: { floor: Floor; heatmap: HeatmapFrame; flat: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const target = useRef<Float32Array | null>(null);
  const current = useRef<Float32Array | null>(null);
  const sinceContour = useRef(Infinity);
  const settled = useRef(false);

  const { rows, cols, resolution_m: res } = heatmap;
  const project = useMemo(() => makeProjector(floor, floor), [floor]);

  const geometry = useMemo(() => {
    // Vertices sit on cell centres, where marching squares samples the field.
    const geo = new THREE.PlaneGeometry((cols - 1) * res, (rows - 1) * res, cols - 1, rows - 1);
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
    settled.current = false;
  }, [heatmap, rows, cols]);

  useEffect(() => {
    settled.current = false;
  }, [flat]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const tgt = target.current;
    const cur = current.current;
    if (!mesh || !tgt || !cur || settled.current) return;
    const k = Math.min(1, delta * 3);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const col = geometry.attributes.color as THREE.BufferAttribute;
    let moving = 0;
    for (let i = 0; i < cur.length; i++) {
      const step = (tgt[i]! - cur[i]!) * k;
      moving = Math.max(moving, Math.abs(step));
      const v = (cur[i]! += step);
      pos.setY(i, heightOf(v, flat) + 0.02);
      const tint = TERRACES[bandOf(v, LEVELS)]!;
      col.setXYZ(i, tint.r, tint.g, tint.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geometry.computeVertexNormals();

    sinceContour.current += delta;
    const done = moving < 0.002;
    if (sinceContour.current >= 1 / CONTOUR_HZ || done) {
      sinceContour.current = 0;
      traceContours(cur);
    }
    if (done) settled.current = true;
  });

  // Marching squares over the eased grid. It is stored north → south, so a traced
  // plan y comes out mirrored: flip it back before projecting.
  function traceContours(grid: Float32Array) {
    const lines = linesRef.current;
    if (!lines) return;
    const positions: number[] = [];
    const colors: number[] = [];
    const span = rows * res;
    LEVELS.forEach((level, i) => {
      const h = heightOf(level, flat) + 0.05;
      const { r, g, b } = CONTOURS[i]!;
      for (const [x1, y1, x2, y2] of isolines(grid, rows, cols, res, level)) {
        positions.push(...project(x1, span - y1, h), ...project(x2, span - y2, h));
        colors.push(r, g, b, r, g, b);
      }
    });
    const geo = lines.geometry;
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeBoundingSphere();
  }

  return (
    <group>
      <mesh ref={meshRef} geometry={geometry} renderOrder={1}>
        <meshStandardMaterial vertexColors transparent opacity={0.92} roughness={0.7} metalness={0} depthWrite={false} />
      </mesh>
      {/* Drawn after the translucent surface so it never dims the hairlines. */}
      <lineSegments ref={linesRef} renderOrder={2}>
        <bufferGeometry />
        <lineBasicMaterial vertexColors />
      </lineSegments>
    </group>
  );
}
