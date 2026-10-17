/**
 * Density field helpers: decoding the heatmap wire format, the density colour ramp,
 * and marching-squares isolines (contours of equal people/m²), the platform's visual
 * signature. Pure functions, shared by the 2D floor plan and the 3D map.
 */

import type { HeatmapFrame } from "@/lib/live-types";

export function decodeHeatmap(frame: HeatmapFrame): Float32Array {
  const binary = atob(frame.cells);
  const out = new Float32Array(binary.length);
  const scale = frame.scale_max / 255;
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) * scale;
  return out;
}

/** Density colour stops in people/m², per the spec's blue → dark red scale. */
const STOPS: Array<[number, [number, number, number]]> = [
  [0.3, [76, 141, 255]],
  [1.0, [63, 191, 111]],
  [2.0, [232, 197, 71]],
  [3.5, [240, 138, 60]],
  [5.0, [229, 72, 77]],
  [6.5, [155, 28, 34]],
];

export function densityColor(value: number): [number, number, number] {
  const first = STOPS[0]!;
  if (value <= first[0]) return first[1];
  for (let i = 1; i < STOPS.length; i++) {
    const [v1, c1] = STOPS[i]!;
    if (value <= v1) {
      const [v0, c0] = STOPS[i - 1]!;
      const t = (value - v0) / (v1 - v0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return STOPS[STOPS.length - 1]![1];
}

export function densityCss(value: number, alpha = 1): string {
  const [r, g, b] = densityColor(value);
  return `rgb(${r | 0} ${g | 0} ${b | 0} / ${alpha})`;
}

export interface DensityLevel {
  label: string;
  max: number;
  css: string;
}

export const DENSITY_LEVELS: DensityLevel[] = [
  { label: "Low", max: 1, css: "var(--severity-low)" },
  { label: "Moderate", max: 2, css: "var(--severity-moderate)" },
  { label: "Busy", max: 3.5, css: "var(--severity-busy)" },
  { label: "High", max: 5, css: "var(--severity-high)" },
  { label: "Critical", max: Infinity, css: "var(--severity-critical)" },
];

export function densityLevel(value: number): DensityLevel {
  return DENSITY_LEVELS.find((l) => value <= l.max) ?? DENSITY_LEVELS[DENSITY_LEVELS.length - 1]!;
}

/** Paints the field into RGBA pixels at grid resolution (row 0 = south edge). */
export function fieldToImage(grid: Float32Array, rows: number, cols: number): ImageData {
  const image = new ImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    // Flip vertically: canvas row 0 is the north edge of the floor.
    const outRow = rows - 1 - r;
    for (let c = 0; c < cols; c++) {
      const v = grid[r * cols + c]!;
      const o = (outRow * cols + c) * 4;
      if (v < 0.03) continue;
      const [red, green, blue] = densityColor(v);
      // Even a lone walker (~0.2 p/m² at the centre of their splat) must read on the plan.
      const t = Math.min(1, (v - 0.03) / 0.6);
      image.data[o] = red;
      image.data[o + 1] = green;
      image.data[o + 2] = blue;
      image.data[o + 3] = Math.round(255 * (0.16 + 0.68 * t * t * (3 - 2 * t)));
    }
  }
  return image;
}

export type Segment = [number, number, number, number];

/**
 * Marching squares over cell centres. Returns segments in floor meters for one level.
 * Saddle cells are resolved by the cell-centre average, which keeps contours of
 * neighbouring crowds from bridging when their gap is below the level.
 */
export function isolines(
  grid: Float32Array,
  rows: number,
  cols: number,
  resolution: number,
  level: number
): Segment[] {
  const segments: Segment[] = [];
  const at = (r: number, c: number) => grid[r * cols + c]!;
  const half = resolution / 2;

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = at(r, c); // bottom-left
      const b = at(r, c + 1); // bottom-right
      const d = at(r + 1, c); // top-left
      const e = at(r + 1, c + 1); // top-right
      let code = 0;
      if (a >= level) code |= 1;
      if (b >= level) code |= 2;
      if (e >= level) code |= 4;
      if (d >= level) code |= 8;
      if (code === 0 || code === 15) continue;

      const x0 = c * resolution + half;
      const y0 = r * resolution + half;
      const lerp = (v1: number, v2: number) => (v1 === v2 ? 0.5 : (level - v1) / (v2 - v1));
      const bottom: [number, number] = [x0 + lerp(a, b) * resolution, y0];
      const right: [number, number] = [x0 + resolution, y0 + lerp(b, e) * resolution];
      const top: [number, number] = [x0 + lerp(d, e) * resolution, y0 + resolution];
      const left: [number, number] = [x0, y0 + lerp(a, d) * resolution];
      const push = (p: [number, number], q: [number, number]) => segments.push([p[0], p[1], q[0], q[1]]);

      switch (code) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(right, top); break;
        case 6: case 9: push(bottom, top); break;
        case 7: case 8: push(left, top); break;
        case 5: case 10: {
          const centerHigh = (a + b + d + e) / 4 >= level;
          if ((code === 5) === centerHigh) {
            push(left, top);
            push(bottom, right);
          } else {
            push(left, bottom);
            push(right, top);
          }
          break;
        }
      }
    }
  }
  return segments;
}

export const ISOLINE_LEVELS = [0.5, 1, 2, 3.5, 5];
