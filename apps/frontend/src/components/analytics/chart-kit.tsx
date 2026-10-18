"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Categorical series colours, validated on the ink-2 surface (#131614) with the
 * dataviz validator: lightness band, chroma, CVD ΔE ≥ 8.4 and normal-vision ΔE ≥ 19.8
 * across all pairs. Capped at three; more series fold into small multiples.
 */
export const SERIES = ["#c98500", "#9085e9", "#199e70"] as const;

/** Severity uses the reserved status scale, always shown with its label. */
export const SEVERITY_FILL = {
  low: "#73766d",
  medium: "#e8c547",
  high: "#f08a3c",
  critical: "#e5484d",
} as const;

export const AXIS = {
  stroke: "rgb(232 228 216 / 0.16)",
  tick: { fill: "#a4a69c", fontSize: 11, fontFamily: "var(--font-mono)" },
  grid: "rgb(232 228 216 / 0.06)",
};

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

/** Tooltip body: values in text ink, a colour swatch carries identity. */
export function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="min-w-40 rounded-[4px] border border-rule-strong bg-ink-3 px-3 py-2 text-xs shadow-lg shadow-black/40">
      <p className="num mb-1.5 text-paper-dim">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-paper-dim">
            {r.color && <span className="h-2 w-2 rounded-[2px]" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="num text-paper">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-xs text-paper-dim">
          <span className="h-[3px] w-3.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** A chart card with a numbered title and a chart/table switch, so no figure is visual-only. */
export function ChartCard({
  index,
  title,
  subtitle,
  actions,
  table,
  children,
  className,
}: {
  index: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  table: { columns: string[]; rows: (string | number)[][] };
  children: React.ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-wrap">
        <div className="min-w-0">
          <CardTitle index={index}>{title}</CardTitle>
          {subtitle && <p className="mt-1.5 text-[13px] text-paper-dim">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
            className="rounded-[3px] border border-rule px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint hover:text-paper"
          >
            {asTable ? "Chart" : "Table"}
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {asTable ? (
          <div className="scrollbar-thin max-h-80 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} className="sticky top-0 bg-ink-2 py-1.5 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="num py-1.5 pr-4 text-paper">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {table.rows.length === 0 && <p className="py-6 text-center text-paper-dim">No data in this range.</p>}
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyChart({ message = "No data in this range yet." }: { message?: string }) {
  return <div className="flex h-full min-h-48 items-center justify-center text-sm text-paper-dim">{message}</div>;
}
