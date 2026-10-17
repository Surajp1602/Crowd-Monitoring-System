import { DENSITY_LEVELS } from "@/lib/isolines";
import { cn } from "@/lib/utils";

export function DensityLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)} aria-label="Density scale">
      {DENSITY_LEVELS.map((level, i) => {
        const lower = i === 0 ? 0 : DENSITY_LEVELS[i - 1]!.max;
        const range = Number.isFinite(level.max) ? `${lower}–${level.max}` : `>${lower}`;
        return (
          <span key={level.label} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-paper-dim">
            <span className="h-2 w-3 rounded-[1px]" style={{ background: level.css }} />
            {level.label}
            <span className="text-paper-faint">{range}</span>
          </span>
        );
      })}
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint">people / m²</span>
    </div>
  );
}
