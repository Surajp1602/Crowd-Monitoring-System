"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ISOLINE_LEVELS,
  decodeHeatmap,
  densityCss,
  densityLevel,
  fieldToImage,
  isolines,
} from "@/lib/isolines";
import type { HeatmapFrame, LivePerson } from "@/lib/live-types";
import type { Camera, Floor, FloorLayout, Wall, Zone } from "@/lib/types";

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
  className?: string;
  /** Hide labels and cameras for small thumbnails. */
  compact?: boolean;
}

const PADDING = 18;

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
    const image = fieldToImage(grid, heatmap.rows, heatmap.cols);
    const lines = ISOLINE_LEVELS.map((level) => ({
      level,
      segments: isolines(grid, heatmap.rows, heatmap.cols, heatmap.resolution_m, level),
    }));
    const bitmap = document.createElement("canvas");
    bitmap.width = heatmap.cols;
    bitmap.height = heatmap.rows;
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

    // Density field, smoothed by bilinear upscaling, then its isolines.
    if (field) {
      const hm = field.heatmap;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, fw, fd);
      ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Soften the cell grid so the field reads as a continuous surface.
      ctx.filter = `blur(${Math.max(1, hm.resolution_m * scale * 0.6).toFixed(1)}px)`;
      const [gx, gy] = toPx(0, hm.rows * hm.resolution_m);
      ctx.drawImage(field.bitmap, gx, gy, hm.cols * hm.resolution_m * scale, hm.rows * hm.resolution_m * scale);
      ctx.filter = "none";
      for (const { level, segments } of field.lines) {
        if (!segments.length) continue;
        ctx.strokeStyle = level >= 3.5 ? densityCss(level, 0.95) : `rgb(236 232 222 / ${0.18 + level * 0.08})`;
        ctx.lineWidth = level >= 3.5 ? 1.4 : 0.9;
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of segments) {
          const [a, b] = toPx(x1, y1);
          const [c, d] = toPx(x2, y2);
          ctx.moveTo(a, b);
          ctx.lineTo(c, d);
        }
        ctx.stroke();
      }
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
      ctx.font = '500 10px "JetBrains Mono Variable", monospace';
      ctx.textBaseline = "top";
      for (const zone of zones) {
        if (zone.polygon.length < 3) continue;
        const minX = Math.min(...zone.polygon.map((p) => p.x));
        const maxY = Math.max(...zone.polygon.map((p) => p.y));
        const [lx, ly] = toPx(minX, maxY);
        const occ = occupancy.get(zone.id);
        ctx.fillStyle = zone.is_restricted ? "rgb(229 72 77 / 0.85)" : "rgb(236 232 222 / 0.55)";
        ctx.fillText(zone.name.toUpperCase(), lx + 5, ly + 5);
        if (occ && occ.count > 0) {
          ctx.fillStyle = "rgb(236 232 222 / 0.9)";
          ctx.fillText(`${occ.count}`, lx + 5, ly + 17);
        }
      }
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
  }, [size, view, floor, zones, cameras, field, people, highlightZoneId, compact, occupancy, draft]);

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
