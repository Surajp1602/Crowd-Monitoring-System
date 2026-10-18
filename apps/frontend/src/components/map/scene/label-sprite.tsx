"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const FONT = '500 22px "JetBrains Mono Variable", ui-monospace, monospace';
const PAD_X = 10;
const HEIGHT = 34;
/** On-screen label height in CSS pixels, whatever the zoom: legible, never shouting. */
const LABEL_PX = 22;
const LABEL_PX_NARROW = 19;
/** Gap kept between labels and from the canvas edge. */
const GAP = 4;
const EDGE = 8;

export interface SceneLabel {
  key: string;
  /** World position of the label's left edge, vertically centred. */
  anchor: [number, number, number];
  text: string;
  accent?: string;
  color?: string;
  accentColor?: string;
  /** Higher wins a contested spot; the loser moves or, failing that, hides. */
  priority: number;
}

/** Overlays the map draws over the canvas (view switcher on top, legend below). */
export interface SafeArea {
  top: number;
  bottom: number;
}

function drawLabel({
  text,
  accent,
  color = "#a4a69c",
  accentColor = "#ece8de",
}: Pick<SceneLabel, "text" | "accent" | "color" | "accentColor">) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = FONT;
  const main = text.toUpperCase();
  const extra = accent ? `  ${accent}` : "";
  const width = Math.ceil(ctx.measureText(main + extra).width) + PAD_X * 2;
  canvas.width = width;
  canvas.height = HEIGHT;
  ctx.font = FONT;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(12, 14, 13, 0.78)";
  ctx.fillRect(0, 0, width, HEIGHT);
  ctx.fillStyle = color;
  ctx.fillText(main, PAD_X, HEIGHT / 2 + 1);
  if (accent) {
    ctx.fillStyle = accentColor;
    ctx.fillText(extra, PAD_X + ctx.measureText(main).width, HEIGHT / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: width / HEIGHT };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/**
 * Text labels drawn into canvas textures and shown as constant-size sprites (no DOM
 * overlays, so they cost no React roots and stay in the WebGL pass). Every frame the
 * camera moves, labels are laid out in screen space: highest priority first, each at
 * its anchor if free, else nudged to the nearest free row, kept inside the canvas and
 * clear of the map's toolbars, and hidden only when no spot is left.
 */
export function LabelLayer({ labels, safeArea }: { labels: SceneLabel[]; safeArea: SafeArea }) {
  // Each label registers its sprite and texture aspect here; the layout reads them per frame.
  const nodes = useRef(new Map<string, { sprite: THREE.Sprite; aspect: number }>());
  const last = useRef({ matrix: new THREE.Matrix4(), w: 0, h: 0, labels: null as SceneLabel[] | null, safe: null as SafeArea | null, version: 0 });
  const version = useRef(0);

  const order = useMemo(() => [...labels].sort((a, b) => b.priority - a.priority), [labels]);

  const ndc = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, size }) => {
    const prev = last.current;
    camera.updateMatrixWorld();
    if (
      prev.labels === order &&
      prev.safe === safeArea &&
      prev.version === version.current &&
      prev.w === size.width &&
      prev.h === size.height &&
      prev.matrix.equals(camera.matrixWorld)
    ) {
      return;
    }
    prev.matrix.copy(camera.matrixWorld);
    prev.w = size.width;
    prev.h = size.height;
    prev.labels = order;
    prev.safe = safeArea;
    prev.version = version.current;

    const W = size.width;
    const H = size.height;
    // sizeAttenuation=false: a sprite of scale s spans s · P[1][1] · H/2 pixels.
    const pxPerUnit = (camera.projectionMatrix.elements[5]! * H) / 2;
    const labelPx = W < 600 ? LABEL_PX_NARROW : LABEL_PX;
    const top = safeArea.top;
    const bottom = H - safeArea.bottom;
    const placed: Rect[] = [];

    for (const label of order) {
      const node = nodes.current.get(label.key);
      if (!node) continue;
      const { sprite, aspect } = node;
      sprite.visible = false;
      ndc.set(...label.anchor).project(camera);
      if (ndc.z < -1 || ndc.z > 1) continue;
      const h = labelPx;
      const w = h * aspect;
      const ax = ((ndc.x + 1) / 2) * W;
      const ay = ((1 - ndc.y) / 2) * H;
      // An anchor well off screen has nothing to point at: hide rather than pin to the edge.
      if (ax < -w / 2 || ax > W + w / 2 || ay < top - h * 2 || ay > bottom + h * 2) continue;

      const x = Math.min(Math.max(ax, EDGE), W - EDGE - w);
      const spot = [0, 1, -1, 2, -2, 3, -3]
        .map((step) => ({ x, y: Math.min(Math.max(ay - h / 2 + step * (h + GAP), top), bottom - h), w, h }))
        .find((r) => r.x >= EDGE && r.y >= top && r.y + h <= bottom && !placed.some((p) => overlaps(p, r)));
      if (!spot) continue;
      placed.push(spot);

      const cx = spot.x + w / 2;
      const cy = spot.y + h / 2;
      ndc.set((cx / W) * 2 - 1, 1 - (cy / H) * 2, ndc.z).unproject(camera);
      sprite.position.copy(ndc);
      sprite.scale.set(w / pxPerUnit, h / pxPerUnit, 1);
      sprite.visible = true;
    }
  });

  const register = (key: string, node: { sprite: THREE.Sprite; aspect: number } | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
    version.current++;
  };

  return (
    <group>
      {labels.map((label) => (
        <LabelSprite key={label.key} label={label} register={register} />
      ))}
    </group>
  );
}

/** One label's texture, redrawn only when its own text or colours change. */
function LabelSprite({
  label,
  register,
}: {
  label: SceneLabel;
  register: (key: string, node: { sprite: THREE.Sprite; aspect: number } | null) => void;
}) {
  const { key, text, accent, color, accentColor } = label;
  const art = useMemo(
    () => drawLabel({ text, accent, color, accentColor }),
    [text, accent, color, accentColor]
  );
  useEffect(() => () => art.texture.dispose(), [art]);

  return (
    <sprite
      ref={(sprite) => {
        register(key, sprite ? { sprite, aspect: art.aspect } : null);
      }}
      visible={false}
      renderOrder={10}
    >
      <spriteMaterial map={art.texture} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}
