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

/** Index of the highest isoline level the value reaches: 0 below the first contour. */
export function bandOf(value: number, levels: number[] = ISOLINE_LEVELS): number {
  let band = 0;
  while (band < levels.length && value >= levels[band]!) band++;
  return band;
}

/** Contours from this level up carry severity colour; quieter ones stay paper. */
export const BUSY_LEVEL = 3.5;

/**
 * Paints the field as stepped terraces: every pixel takes the flat wash of the band
 * between two isolines, so the plan reads like a contour map rather than a heat blur.
 * The grid is sampled bilinearly between cell centres (the same surface marching
 * squares contours), `k` pixels per cell, row 0 = north edge.
 */
export function terraceImage(
  grid: Float32Array,
  rows: number,
  cols: number,
  k: number,
  levels: number[],
  wash: (level: number) => [number, number, number, number]
): ImageData {
  const w = cols * k;
  const h = rows * k;
  const image = new ImageData(Math.max(1, w), Math.max(1, h));
  if (rows < 2 || cols < 2) return image;
  const palette = levels.map(wash);
  for (let py = 0; py < h; py++) {
    // Flip vertically: canvas row 0 is the north edge of the floor.
    const gy = Math.min(rows - 1, Math.max(0, rows - 1 - ((py + 0.5) / k - 0.5)));
    const r0 = Math.min(rows - 2, Math.floor(gy));
    const ty = gy - r0;
    for (let px = 0; px < w; px++) {
      const gx = Math.min(cols - 1, Math.max(0, (px + 0.5) / k - 0.5));
      const c0 = Math.min(cols - 2, Math.floor(gx));
      const tx = gx - c0;
      const i = r0 * cols + c0;
      const bottom = grid[i]! + (grid[i + 1]! - grid[i]!) * tx;
      const top = grid[i + cols]! + (grid[i + cols + 1]! - grid[i + cols]!) * tx;
      const band = bandOf(bottom + (top - bottom) * ty, levels);
      if (band === 0) continue;
      const [red, green, blue, alpha] = palette[band - 1]!;
      const o = (py * w + px) * 4;
      image.data[o] = red;
      image.data[o + 1] = green;
      image.data[o + 2] = blue;
      image.data[o + 3] = alpha;
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

/**
 * Joins marching-squares segments into polylines (flat [x0, y0, x1, y1, …] arrays), so
 * strokes get real joins and dash patterns run continuously along a contour.
 * Neighbouring cells compute shared edge points with the same arithmetic, so their
 * endpoints match exactly.
 */
export function chainSegments(segments: Segment[]): number[][] {
  const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
  const ends = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const [x1, y1, x2, y2] = segments[i]!;
    for (const k of [key(x1, y1), key(x2, y2)]) {
      const list = ends.get(k);
      if (list) list.push(i);
      else ends.set(k, [i]);
    }
  }
  const used = new Uint8Array(segments.length);
  const next = (x: number, y: number): [number, number] | null => {
    for (const i of ends.get(key(x, y)) ?? []) {
      if (used[i]) continue;
      used[i] = 1;
      const [x1, y1, x2, y2] = segments[i]!;
      return key(x1, y1) === key(x, y) ? [x2, y2] : [x1, y1];
    }
    return null;
  };
  const lines: number[][] = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const [x1, y1, x2, y2] = segments[i]!;
    const forward = [x1, y1, x2, y2];
    for (let p = next(x2, y2); p; p = next(p[0], p[1])) forward.push(p[0], p[1]);
    const backward: number[] = [];
    for (let p = next(x1, y1); p; p = next(p[0], p[1])) backward.unshift(p[0], p[1]);
    lines.push(backward.concat(forward));
  }
  return lines;
}

export const ISOLINE_LEVELS = [0.5, 1, 2, 3.5, 5];

/**
 * A dashed supplementary contour below the first legend level, as survey maps add
 * half-interval lines on gentle ground: a quiet venue still shows where people are.
 */
export const SUPPLEMENTARY_LEVEL = 0.2;
