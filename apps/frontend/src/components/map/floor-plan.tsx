"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BUSY_LEVEL,
  ISOLINE_LEVELS,
  decodeHeatmap,
  densityColor,
  densityCss,
  densityLevel,
  SUPPLEMENTARY_LEVEL,
  chainSegments,
  isolines,
  terraceImage,
} from "@/lib/isolines";
import type { HeatmapFrame, LivePerson } from "@/lib/live-types";
import type { Camera, Floor, FloorLayout, Wall, Zone } from "@/lib/types";

export interface PlanMarker {
  id: string;
  x: number;
  y: number;
  severity: "low" | "medium" | "high" | "critical";
  selected?: boolean;
}

const MARKER_COLOR: Record<PlanMarker["severity"], string> = {
  low: "#a4a69c",
  medium: "#e8c547",
  high: "#f08a3c",
  critical: "#e5484d",
};

export interface PlanPoint {
  x: number;
  y: number;
}

/** In-progress edits drawn over the plan by the map editor. */
export interface PlanDraft {
  polygon?: PlanPoint[];
  walls?: Wall[];
  /** Rubber band from the last placed point to the cursor. */
  from?: PlanPoint | null;
  cursor?: PlanPoint | null;
  selectedCameraId?: string | null;
}
import { cn } from "@/lib/utils";

interface FloorPlanProps {
  floor: Floor;
  zones?: Zone[];
  cameras?: Camera[];
  heatmap?: HeatmapFrame | null;
  people?: LivePerson[];
  highlightZoneId?: string | null;
  onZoneClick?: (zone: Zone) => void;
  onFloorClick?: (point: PlanPoint) => void;
  onFloorDoubleClick?: (point: PlanPoint) => void;
  onHover?: (point: PlanPoint | null) => void;
  draft?: PlanDraft;
  /** Alert locations, drawn as severity-coloured rings. */
  markers?: PlanMarker[];
  className?: string;
  /** Hide labels and cameras for small thumbnails. */
  compact?: boolean;
}

const PADDING = 18;

/** Terrace bitmap pixels per heatmap cell: enough for crisp steps once upscaled. */
const TERRACE_K = 6;

const TERRACE_LEVELS = [SUPPLEMENTARY_LEVEL, ...ISOLINE_LEVELS];

/** Paper contours grow firmer with density, like index contours on a survey map. */
const CONTOUR_ALPHA: Record<number, number> = { [SUPPLEMENTARY_LEVEL]: 0.55, 0.5: 0.55, 1: 0.7, 2: 0.85 };

/** Each band a touch lighter than the one below; busy bands take a whisper of severity. */
function terraceWash(level: number): [number, number, number, number] {
  if (level >= BUSY_LEVEL) {
    const [r, g, b] = densityColor(level);
    return [r, g, b, level >= 5 ? 64 : 44];
  }
  return [236, 232, 222, 6 + TERRACE_LEVELS.indexOf(level) * 9];
}

interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rows: string[];
  /** Row the zone's head count is drawn on, -1 for none. */
  countRow: number;
  font: string;
  lineHeight: number;
}

const boxesOverlap = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2;

const LABEL_FONTS = [
  { font: '500 10px "JetBrains Mono Variable", monospace', lineHeight: 12 },
  { font: '500 9px "JetBrains Mono Variable", monospace', lineHeight: 11 },
];

/**
 * Wraps a zone name onto at most two lines that fit its zone's width, once per label
 * font size, largest first. Sizes at which a single word would spill are left out.
 */
function fitLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const fits: Array<{ lines: string[]; font: string; lineHeight: number }> = [];
  if (maxWidth <= 0) return fits;
  for (const { font, lineHeight } of LABEL_FONTS) {
    ctx.font = font;
    const lines: string[] = [];
    let ok = true;
    for (const word of text.split(/\s+/)) {
      const last = lines[lines.length - 1];
      if (last && ctx.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
      else lines.push(word);
      if (ctx.measureText(word).width > maxWidth) ok = false;
    }
    if (ok && lines.length <= 2) fits.push({ lines, font, lineHeight });
  }
  return fits;
}

function pointInPolygon(x: number, y: number, polygon: Array<{ x: number; y: number }>) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { x: xi, y: yi } = polygon[i]!;
    const { x: xj, y: yj } = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Plan view of one floor, north up: walls, zones, cameras and their fields of view,
 * the live density field with isolines, and every tracked person as a dot.
 */
export function FloorPlan({
  floor,
  zones = [],
  cameras = [],
  heatmap,
  people = [],
  highlightZoneId,
  onZoneClick,
  onFloorClick,
  onFloorDoubleClick,
  onHover,
  draft,
  markers,
  className,
  compact,
}: FloorPlanProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    const scale = Math.max(
      0.1,
      Math.min((size.w - PADDING * 2) / floor.width_m, (size.h - PADDING * 2) / floor.depth_m)
    );
    const ox = (size.w - floor.width_m * scale) / 2;
    const oy = (size.h - floor.depth_m * scale) / 2;
    return {
      scale,
      toPx: (x: number, y: number): [number, number] => [ox + x * scale, oy + (floor.depth_m - y) * scale],
      toFloor: (px: number, py: number) => ({ x: (px - ox) / scale, y: floor.depth_m - (py - oy) / scale }),
      ox,
      oy,
    };
  }, [size, floor.width_m, floor.depth_m]);

  const field = useMemo(() => {
    if (!heatmap || heatmap.floor_id !== floor.id) return null;
    const grid = decodeHeatmap(heatmap);
    const image = terraceImage(grid, heatmap.rows, heatmap.cols, TERRACE_K, TERRACE_LEVELS, terraceWash);
    const lines = TERRACE_LEVELS.map((level) => ({
      level,
      paths: chainSegments(isolines(grid, heatmap.rows, heatmap.cols, heatmap.resolution_m, level)),
    }));
    const bitmap = document.createElement("canvas");
    bitmap.width = image.width;
    bitmap.height = image.height;
    bitmap.getContext("2d")?.putImageData(image, 0, 0);
    return { bitmap, lines, heatmap };
  }, [heatmap, floor.id]);

  const occupancy = useMemo(
    () => new Map((heatmap?.zones ?? []).map((z) => [z.zone_id, z])),
    [heatmap]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const { toPx, scale, ox, oy } = view;
    const fw = floor.width_m * scale;
    const fd = floor.depth_m * scale;

    // Floor slab with a 5 m survey grid.
    ctx.fillStyle = "#101311";
    ctx.fillRect(ox, oy, fw, fd);
    ctx.strokeStyle = "rgb(232 228 216 / 0.035)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 5; x < floor.width_m; x += 5) {
      const [px] = toPx(x, 0);
      ctx.moveTo(Math.round(px) + 0.5, oy);
      ctx.lineTo(Math.round(px) + 0.5, oy + fd);
    }
    for (let y = 5; y < floor.depth_m; y += 5) {
      const [, py] = toPx(0, y);
      ctx.moveTo(ox, Math.round(py) + 0.5);
      ctx.lineTo(ox + fw, Math.round(py) + 0.5);
    }
    ctx.stroke();

    // Zones: hairline outlines; restricted zones hatched.
    for (const zone of zones) {
      if (zone.polygon.length < 3) continue;
      ctx.beginPath();
      zone.polygon.forEach((p, i) => {
        const [px, py] = toPx(p.x, p.y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      const highlighted = zone.id === highlightZoneId;
      if (zone.is_restricted) {
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = "rgb(229 72 77 / 0.16)";
        ctx.lineWidth = 1;
        for (let d = -fd; d < fw + fd; d += 7) {
          ctx.beginPath();
          ctx.moveTo(ox + d, oy);
          ctx.lineTo(ox + d + fd, oy + fd);
          ctx.stroke();
        }
        ctx.restore();
        ctx.beginPath();
        zone.polygon.forEach((p, i) => {
          const [px, py] = toPx(p.x, p.y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
      }
      ctx.setLineDash(highlighted ? [] : [3, 4]);
      ctx.strokeStyle = highlighted
        ? "#f2a93b"
        : zone.is_restricted
          ? "rgb(229 72 77 / 0.55)"
          : "rgb(232 228 216 / 0.22)";
      ctx.lineWidth = highlighted ? 1.5 : 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Density field as a contour map: faint stepped terraces between the isolines,
    // then the isolines themselves as hairlines. Only busy contours carry colour.
    if (field) {
      const hm = field.heatmap;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, fw, fd);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const [gx, gy] = toPx(0, hm.rows * hm.resolution_m);
      ctx.drawImage(field.bitmap, gx, gy, hm.cols * hm.resolution_m * scale, hm.rows * hm.resolution_m * scale);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const { level, paths } of field.lines) {
        if (!paths.length) continue;
        const busy = level >= BUSY_LEVEL;
        ctx.strokeStyle = busy ? densityCss(level, 1) : `rgb(236 232 222 / ${CONTOUR_ALPHA[level] ?? 0.6})`;
        ctx.lineWidth = busy ? 1.25 : level === SUPPLEMENTARY_LEVEL ? 1.2 : compact ? 0.75 : 0.9;
        // Dotted, so the supplementary line never reads as a dashed zone outline.
        ctx.setLineDash(level === SUPPLEMENTARY_LEVEL ? [0.1, 3] : []);
        ctx.beginPath();
        for (const path of paths) {
          for (let i = 0; i < path.length; i += 2) {
            const [px, py] = toPx(path[i]!, path[i + 1]!);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Structure on top of the field so walls always read.
    const layout = (floor.layout ?? {}) as FloorLayout;
    const walls = draft?.walls ?? layout.walls ?? [];
    ctx.strokeStyle = "rgb(236 232 222 / 0.7)";
    ctx.lineWidth = 2;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (const w of walls) {
      const [a, b] = toPx(w.x1, w.y1);
      const [c, d] = toPx(w.x2, w.y2);
      ctx.moveTo(a, b);
      ctx.lineTo(c, d);
    }
    ctx.stroke();
    if (!walls.length) {
      ctx.strokeStyle = "rgb(236 232 222 / 0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + 0.5, oy + 0.5, fw - 1, fd - 1);
    }

    if (!compact) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, fw, fd);
      ctx.clip();
      for (const cam of cameras) {
        const [cx, cy] = toPx(cam.map_x, cam.map_y);
        const r = cam.range_m * scale;
        // Screen y is flipped, so the yaw sweeps clockwise on screen.
        const yaw = (-cam.orientation_deg * Math.PI) / 180;
        const half = (cam.fov_deg * Math.PI) / 360;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, yaw - half, yaw + half);
        ctx.closePath();
        const picked = cam.id === draft?.selectedCameraId;
        ctx.fillStyle = picked ? "rgb(242 169 59 / 0.16)" : "rgb(242 169 59 / 0.045)";
        ctx.fill();
        ctx.strokeStyle = picked ? "rgb(242 169 59 / 0.9)" : "rgb(242 169 59 / 0.28)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = cam.status === "online" ? "#f2a93b" : "#73766d";
        ctx.fillRect(cx - 3, cy - 3, 6, 6);
      }
      ctx.restore();
    }

    for (const p of people) {
      const [px, py] = toPx(p.x, p.y);
      if (px < ox || px > ox + fw || py < oy || py > oy + fd) continue;
      ctx.fillStyle = p.speed_mps >= 3 ? "#e5484d" : p.speed_mps >= 2 ? "#f2a93b" : "#ece8de";
      ctx.beginPath();
      ctx.arc(px, py, compact ? 1.4 : 2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!compact) {
      ctx.textBaseline = "top";
      const placed: LabelBox[] = [];
      // Busiest zones claim their corner first; the rest wrap, shift down or drop out.
      const ordered = [...zones]
        .filter((z) => z.polygon.length >= 3)
        .sort((a, b) => (occupancy.get(b.id)?.count ?? 0) - (occupancy.get(a.id)?.count ?? 0));
      for (const zone of ordered) {
        const xs = zone.polygon.map((p) => p.x);
        const ys = zone.polygon.map((p) => p.y);
        const [lx, ly] = toPx(Math.min(...xs), Math.max(...ys));
        const [rx, by] = toPx(Math.max(...xs), Math.min(...ys));
        const occ = occupancy.get(zone.id);
        const count = occ && occ.count > 0 ? `${occ.count}` : null;
        const maxWidth = Math.min(rx, size.w) - lx - 10;
        const zoneBottom = Math.min(by, size.h) - 1;
        let box: LabelBox | null = null;
        // Largest font first. The count takes its own line, or rides on the shortest
        // name line when the zone is too short for that.
        for (const fit of fitLabel(ctx, zone.name.toUpperCase(), maxWidth)) {
          ctx.font = fit.font;
          const widths = fit.lines.map((l) => ctx.measureText(l).width);
          const layouts: Array<{ rows: string[]; countRow: number }> = [];
          if (count) {
            layouts.push({ rows: [...fit.lines, ""], countRow: fit.lines.length });
            const shortest = widths.indexOf(Math.min(...widths));
            if (ctx.measureText(`${fit.lines[shortest]}  ${count}`).width <= maxWidth) {
              layouts.push({ rows: fit.lines, countRow: shortest });
            }
          } else {
            layouts.push({ rows: fit.lines, countRow: -1 });
          }
          for (const { rows, countRow } of layouts) {
            const w =
              Math.max(...rows.map((l, i) => ctx.measureText(i === countRow ? `${l}  ${count}` : l).width)) + 6;
            const h = rows.length * fit.lineHeight + 2;
            const x = Math.min(lx + 2, size.w - w - 2);
            for (let y = ly + 1; y + h <= zoneBottom && !box; y += fit.lineHeight) {
              const candidate = { x, y, w, h, rows, countRow, font: fit.font, lineHeight: fit.lineHeight };
              if (!placed.some((p) => boxesOverlap(p, candidate))) box = candidate;
            }
            if (box) break;
          }
          if (box) break;
        }
        if (!box) continue;
        placed.push(box);
        ctx.fillStyle = "rgb(12 14 13 / 0.72)";
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.font = box.font;
        box.rows.forEach((line, i) => {
          const ty = box.y + 1.5 + i * box.lineHeight;
          ctx.fillStyle = zone.is_restricted ? "rgb(229 72 77 / 0.85)" : "rgb(236 232 222 / 0.6)";
          ctx.fillText(line, box.x + 3, ty);
          if (i === box.countRow && count) {
            ctx.fillStyle = "rgb(236 232 222 / 0.9)";
            ctx.fillText(count, box.x + 3 + (line ? ctx.measureText(`${line}  `).width : 0), ty);
          }
        });
      }
    }

    for (const m of markers ?? []) {
      const [mx, my] = toPx(m.x, m.y);
      const color = MARKER_COLOR[m.severity];
      ctx.strokeStyle = color;
      ctx.lineWidth = m.selected ? 2 : 1.25;
      for (const r of m.selected ? [7, 13, 19] : [7, 12]) {
        ctx.globalAlpha = r === 7 ? 1 : r === 12 || r === 13 ? 0.55 : 0.3;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx, my, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (draft) {
      ctx.strokeStyle = "#f2a93b";
      ctx.fillStyle = "rgb(242 169 59 / 0.12)";
      ctx.lineWidth = 1.5;
      const poly = draft.polygon ?? [];
      if (poly.length) {
        ctx.beginPath();
        poly.forEach((p, i) => {
          const [px, py] = toPx(p.x, p.y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        if (poly.length >= 3) {
          ctx.closePath();
          ctx.fill();
        }
        ctx.stroke();
        for (const p of poly) {
          const [px, py] = toPx(p.x, p.y);
          ctx.fillStyle = "#f2a93b";
          ctx.fillRect(px - 3, py - 3, 6, 6);
        }
      }
      if (draft.from && draft.cursor) {
        const [a, b] = toPx(draft.from.x, draft.from.y);
        const [c, d] = toPx(draft.cursor.x, draft.cursor.y);
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(a, b);
        ctx.lineTo(c, d);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '500 10px "JetBrains Mono Variable", monospace';
        ctx.fillStyle = "#f2a93b";
        ctx.fillText(`${Math.hypot(draft.cursor.x - draft.from.x, draft.cursor.y - draft.from.y).toFixed(1)} m`, c + 8, d - 8);
      }
      if (draft.cursor) {
        const [c, d] = toPx(draft.cursor.x, draft.cursor.y);
        ctx.strokeStyle = "rgb(242 169 59 / 0.8)";
        ctx.beginPath();
        ctx.moveTo(c - 6, d);
        ctx.lineTo(c + 6, d);
        ctx.moveTo(c, d - 6);
        ctx.lineTo(c, d + 6);
        ctx.stroke();
      }
    }
  }, [size, view, floor, zones, cameras, field, people, highlightZoneId, compact, occupancy, draft, markers]);

  const hoverZone = useMemo(() => {
    if (!hover) return null;
    return zones.find((z) => z.polygon.length >= 3 && pointInPolygon(hover.x, hover.y, z.polygon)) ?? null;
  }, [hover, zones]);

  const hoverDensity = useMemo(() => {
    if (!hover || !field) return null;
    const hm = field.heatmap;
    const c = Math.floor(hover.x / hm.resolution_m);
    const r = Math.floor(hover.y / hm.resolution_m);
    if (r < 0 || c < 0 || r >= hm.rows || c >= hm.cols) return null;
    return decodeHeatmap(hm)[r * hm.cols + c] ?? null;
  }, [hover, field]);

  const interactive = Boolean(onZoneClick || onFloorClick || draft);

  // Clicks resolve their own position: hover state can lag a click that arrives
  // without a preceding mouse move (touch, pen, synthetic events).
  function pointFromEvent(e: React.MouseEvent<HTMLDivElement>): PlanPoint | null {
    const rect = e.currentTarget.getBoundingClientRect();
    const { x, y } = view.toFloor(e.clientX - rect.left, e.clientY - rect.top);
    return x >= 0 && y >= 0 && x <= floor.width_m && y <= floor.depth_m ? { x, y } : null;
  }

  return (
    <div
      ref={wrapRef}
      className={cn("relative h-full w-full select-none", interactive && "cursor-crosshair", className)}
      onMouseMove={(e) => {
        if (compact) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const { x, y } = view.toFloor(px, py);
        const inside = x >= 0 && y >= 0 && x <= floor.width_m && y <= floor.depth_m;
        setHover(inside ? { x, y, px, py } : null);
        onHover?.(inside ? { x, y } : null);
      }}
      onMouseLeave={() => {
        setHover(null);
        onHover?.(null);
      }}
      onClick={(e) => {
        const p = pointFromEvent(e);
        if (!p) return;
        const zone = onZoneClick
          ? zones.find((z) => z.polygon.length >= 3 && pointInPolygon(p.x, p.y, z.polygon))
          : undefined;
        if (zone && onZoneClick) onZoneClick(zone);
        else onFloorClick?.(p);
      }}
      onDoubleClick={(e) => {
        const p = pointFromEvent(e);
        if (p) onFloorDoubleClick?.(p);
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label={`Floor plan of ${floor.name}`} role="img" />
      {hover && !compact && (
        <div
          className="pointer-events-none absolute z-10 min-w-36 rounded-[4px] border border-rule-strong bg-ink-3/95 px-2.5 py-2 text-xs shadow-lg shadow-black/40"
          style={{
            left: Math.min(hover.px + 14, size.w - 160),
            top: Math.min(hover.py + 14, size.h - 80),
          }}
        >
          {hoverZone && <p className="font-medium text-paper">{hoverZone.name}</p>}
          <p className="num text-paper-faint">
            {hover.x.toFixed(1)}, {hover.y.toFixed(1)} m
          </p>
          {hoverDensity !== null && hoverDensity > 0.05 && (
            <p className="num mt-1" style={{ color: densityLevel(hoverDensity).css }}>
              {hoverDensity.toFixed(2)} p/m² · {densityLevel(hoverDensity).label}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
