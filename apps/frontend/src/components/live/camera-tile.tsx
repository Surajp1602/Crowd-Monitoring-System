"use client";

import { useEffect, useRef } from "react";
import { useCameraFeed } from "@/hooks/use-live";
import type { CameraFrame } from "@/lib/live-types";
import type { Camera } from "@/lib/types";
import { cn } from "@/lib/utils";

function boxColor(confidence: number) {
  return confidence >= 0.8 ? "#ece8de" : "#a4a69c";
}

/** Draws the latest boxes over the (less frequent) JPEG preview, so boxes stay fluid. */
function BoxOverlay({ frame }: { frame: CameraFrame | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { width, height } = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const b of frame?.boxes ?? []) {
      ctx.strokeStyle = boxColor(b.confidence);
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x1 * width, b.y1 * height, (b.x2 - b.x1) * width, (b.y2 - b.y1) * height);
    }
  }, [frame]);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}

export function CameraTile({
  camera,
  large,
  onSelect,
  selected,
}: {
  camera: Camera;
  large?: boolean;
  onSelect?: () => void;
  selected?: boolean;
}) {
  const { frame, preview, health } = useCameraFeed(camera.id);
  const status = health?.status ?? camera.status;
  const online = status === "online";

  const Wrapper = onSelect ? "button" : "div";

  return (
    <Wrapper
      type={onSelect ? "button" : undefined}
      onClick={onSelect}
      className={cn(
        "group panel flex w-full flex-col overflow-hidden text-left transition-colors",
        onSelect && "hover:border-rule-strong",
        selected && "border-amber/70"
      )}
    >
      <div className="relative aspect-video w-full bg-[#080908]">
        {preview && online ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/jpeg;base64,${preview}`}
            alt={`Live view from ${camera.name}`}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-paper-faint">
              {status === "error" ? "Stream error" : online ? "Waiting for frames" : "No signal"}
            </span>
          </div>
        )}
        {online && !large && <BoxOverlay frame={frame} />}
        <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-[3px] bg-black/65 px-1.5 py-0.5">
          <span
            className={cn(
              "size-1.5 rounded-full",
              online ? "bg-severity-critical" : status === "error" ? "bg-severity-high" : "bg-paper-faint"
            )}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-paper">
            {online ? "Rec" : status}
          </span>
        </div>
        {frame && online && (
          <div className="absolute bottom-2 right-2 rounded-[3px] bg-black/65 px-1.5 py-0.5 font-mono text-[11px] text-paper">
            {frame.person_count === 0 ? "No one in view" : `${frame.person_count} ppl`}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-rule px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] text-paper">{camera.name}</p>
          <p className="truncate font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint">{camera.code}</p>
        </div>
        <div className="num shrink-0 text-right text-[11px] text-paper-dim">
          <p>{health ? `${health.fps.toFixed(1)} fps` : "—"}</p>
          <p className="text-paper-faint">{health ? `${Math.round(health.latency_ms)} ms` : ""}</p>
        </div>
      </div>
    </Wrapper>
  );
}
