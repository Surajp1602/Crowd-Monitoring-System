"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";

const FONT = '500 22px "JetBrains Mono Variable", ui-monospace, monospace';
const PAD_X = 10;
const HEIGHT = 34;

/**
 * A text label drawn into a canvas texture and shown as a constant-size sprite. Used
 * instead of DOM overlays so labels cost no React roots and stay in the WebGL pass.
 */
export function LabelSprite({
  position,
  text,
  accent,
  color = "#a4a69c",
  accentColor = "#ece8de",
}: {
  position: [number, number, number];
  text: string;
  accent?: string;
  color?: string;
  accentColor?: string;
}) {
  const { texture, aspect } = useMemo(() => {
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
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { texture: tex, aspect: width / HEIGHT };
  }, [text, accent, color, accentColor]);

  useEffect(() => () => texture.dispose(), [texture]);

  // sizeAttenuation=false: scale is in clip-space units, so labels keep a steady size.
  const h = 0.032;
  return (
    <sprite position={position} scale={[h * aspect, h, 1]} renderOrder={10}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} transparent />
    </sprite>
  );
}
