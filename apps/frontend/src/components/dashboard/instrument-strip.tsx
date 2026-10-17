"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface Readout {
  label: string;
  value: string | number;
  unit?: string;
  detail?: string;
  tone?: "default" | "amber" | "critical" | "ok";
  color?: string;
}

/** One panel of readouts divided by hairlines, like a control-room status bar. */
export function InstrumentStrip({ readouts, loading }: { readouts: Readout[]; loading?: boolean }) {
  return (
    <section
      aria-label="Facility status"
      className="panel grid grid-cols-2 divide-rule sm:grid-cols-3 xl:grid-cols-5 xl:divide-x [&>*]:border-rule max-xl:[&>*]:border-b"
    >
      {readouts.map((r) => (
        <div key={r.label} className="min-w-0 px-5 py-4">
          <p className="eyebrow truncate">{r.label}</p>
          {loading ? (
            <Skeleton className="mt-3 h-8 w-20" />
          ) : (
            <p
              className={cn(
                "num mt-2 truncate text-[28px] font-medium leading-none tracking-[-0.03em] text-paper",
                r.tone === "amber" && "text-amber",
                r.tone === "critical" && "text-severity-critical",
                r.tone === "ok" && "text-severity-moderate"
              )}
              style={r.color ? { color: r.color } : undefined}
            >
              {r.value}
              {r.unit && <span className="ml-1.5 text-xs font-normal tracking-normal text-paper-faint">{r.unit}</span>}
            </p>
          )}
          {r.detail && <p className="mt-2 truncate text-xs text-paper-dim">{r.detail}</p>}
        </div>
      ))}
    </section>
  );
}
