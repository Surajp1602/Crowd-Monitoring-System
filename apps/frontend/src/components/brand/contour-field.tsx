"use client";

import { useEffect, useRef } from "react";
import { isolines } from "@/lib/isolines";

interface Hill {
  x: number;
  y: number;
  vx: number;
  vy: number;
  amp: number;
  sigma: number;
}

const COLS = 96;
const ROWS = 64;
const LEVELS = [0.35, 0.7, 1.1, 1.6, 2.2, 2.9, 3.7];

/**
 * A slowly drifting density landscape drawn only as isolines: the brand's "crowds are
 * terrain" idea, rendered by the same marching-squares code as the live floor plan.
 * One hill runs hot so a single contour turns amber.
 */
export function ContourField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const hills: Hill[] = Array.from({ length: 7 }, (_, i) => ({
      x: 10 + rand() * (COLS - 20),
      y: 8 + rand() * (ROWS - 16),
      vx: (rand() - 0.5) * 0.9,
      vy: (rand() - 0.5) * 0.6,
      amp: i === 0 ? 4.4 : 1.2 + rand() * 1.9,
      sigma: 5 + rand() * 7,
    }));
    const grid = new Float32Array(ROWS * COLS);

    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      grid.fill(0);
      for (const h of hills) {
        const r = Math.ceil(h.sigma * 3);
        const s2 = 2 * h.sigma * h.sigma;
        for (let row = Math.max(0, Math.floor(h.y - r)); row < Math.min(ROWS, h.y + r); row++) {
          for (let col = Math.max(0, Math.floor(h.x - r)); col < Math.min(COLS, h.x + r); col++) {
            const dx = col - h.x;
            const dy = row - h.y;
            grid[row * COLS + col]! += h.amp * Math.exp(-(dx * dx + dy * dy) / s2);
          }
        }
      }

      // Cover the canvas (like object-fit: cover) so contours always reach the edges.
      const scale = Math.max(width / COLS, height / ROWS);
      const ox = (width - COLS * scale) / 2;
      const oy = (height - ROWS * scale) / 2;
      LEVELS.forEach((level, i) => {
        const hot = i === LEVELS.length - 1;
        ctx.strokeStyle = hot ? "rgb(242 169 59 / 0.95)" : `rgb(236 232 222 / ${0.07 + i * 0.045})`;
        ctx.lineWidth = hot ? 1.4 : 1;
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of isolines(grid, ROWS, COLS, 1, level)) {
          ctx.moveTo(ox + x1 * scale, oy + y1 * scale);
          ctx.lineTo(ox + x2 * scale, oy + y2 * scale);
        }
        ctx.stroke();
      });
    };

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      for (const h of hills) {
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        if (h.x < 6 || h.x > COLS - 6) h.vx *= -1;
        if (h.y < 6 || h.y > ROWS - 6) h.vy *= -1;
      }
      if (acc > 1 / 24) {
        acc = 0;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };

    draw();
    if (!reduce) raf = requestAnimationFrame(tick);
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
