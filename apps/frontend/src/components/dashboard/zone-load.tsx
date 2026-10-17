"use client";

import { densityLevel } from "@/lib/isolines";
import type { ZoneOccupancy } from "@/lib/live-types";
import { cn } from "@/lib/utils";

/** Zones ranked by how close they are to capacity, with live density. */
export function ZoneLoad({
  zones,
  onHover,
  highlightId,
}: {
  zones: ZoneOccupancy[];
  onHover?: (zoneId: string | null) => void;
  highlightId?: string | null;
}) {
  const ranked = [...zones].sort((a, b) => load(b) - load(a) || b.count - a.count);

  if (!ranked.length) {
    return <p className="py-8 text-center text-sm text-paper-dim">Waiting for the first density reading…</p>;
  }

  return (
    <ul className="divide-y divide-rule" onMouseLeave={() => onHover?.(null)}>
      {ranked.map((z) => {
        const pct = Math.min(100, load(z) * 100);
        const level = densityLevel(z.density);
        const over = z.capacity_threshold !== null && z.count > z.capacity_threshold;
        return (
          <li
            key={z.zone_id}
            onMouseEnter={() => onHover?.(z.zone_id)}
            className={cn("px-1 py-2.5 transition-colors", highlightId === z.zone_id && "bg-ink-3/70")}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-[13px] text-paper">
                {z.name}
                {z.is_restricted && (
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.06em] text-severity-critical">
                    Restricted
                  </span>
                )}
              </p>
              <p className="num shrink-0 text-xs text-paper-dim">
                <span className={cn("text-paper", over && "text-severity-critical")}>{z.count}</span>
                {z.capacity_threshold !== null && <span className="text-paper-faint"> / {z.capacity_threshold}</span>}
              </p>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ink-4">
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out-expo"
                  style={{ width: `${pct}%`, background: over ? "var(--severity-critical)" : level.css }}
                />
              </div>
              <span className="num w-20 shrink-0 text-right text-[11px]" style={{ color: level.css }}>
                {z.density.toFixed(2)} p/m²
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function load(z: ZoneOccupancy) {
  if (z.is_restricted && z.count > 0) return 2; // any presence in a restricted zone ranks first
  return z.capacity_threshold ? z.count / z.capacity_threshold : z.density / 5;
}
