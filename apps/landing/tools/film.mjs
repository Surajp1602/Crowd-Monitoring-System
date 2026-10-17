#!/usr/bin/env node
// Turn raw generations into web-ready media (ffmpeg; zero config).
//
//   node tools/film.mjs all                      -> process everything listed in juried/asset-plan.json "outputs"
//   node tools/film.mjs scrub <in.mp4> <name>    -> scroll-scrub encodes (desktop + mobile) + first/last frame posters
//   node tools/film.mjs loop  <in.mp4> <name>    -> small silent looping clip + poster (optionally --pingpong)
//   node tools/film.mjs still <in.png> <name>    -> responsive webp/jpg set (640/1280/1920/2560)
//
// ffmpeg is found via FFMPEG_PATH, the ffmpeg-static package, or your PATH.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const OUT = path.resolve(process.cwd(), 'public/media');

function ffmpegBin() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch {}
  return 'ffmpeg';
}
const FF = ffmpegBin();

function ff(args) {
  const r = spawnSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error) throw new Error(`Could not run ffmpeg (${FF}): ${r.error.message}. Run "npm install" (ffmpeg-static) or install ffmpeg.`);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

function probe(file) {
  const r = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const err = r.stderr || '';
  const d = err.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  const f = err.match(/(\d+(?:\.\d+)?) fps/);
  return { duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0, fps: f ? parseFloat(f[1]) : 30 };
}
const probeDuration = (file) => probe(file).duration;

const size = (f) => (fs.statSync(f).size / 1e6).toFixed(1) + ' MB';

// public/media/media.json tells the page which media exist, so every section can fall back gracefully.
function record(name, patch) {
  const file = path.join(OUT, 'media.json');
  const m = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  m[name] = { ...(m[name] || {}), ...patch };
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
}

// Scroll-scrubbed film: short GOP so seeking is instant in every browser; no audio; faststart.
// A keyframe every 6 frames keeps any seek to at most 5 decoded frames (measured: same SSIM as a 4-frame GOP
// with fastdecode, at ~60% of the size).
export function scrub(input, name, { width = 1920, crf = 23 } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const base = path.join(OUT, name);
  const common = ['-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-movflags', '+faststart', '-g', '6', '-keyint_min', '6', '-sc_threshold', '0'];
  // Keep the source frame rate (never invent frames), capped at 30 for desktop and 24 for mobile.
  const srcFps = probe(input).fps;
  const fpsD = srcFps > 30 ? ',fps=30' : '', fpsM = srcFps > 24 ? ',fps=24' : '';
  ff(['-i', input, '-vf', `scale='min(${width},iw)':-2:flags=lanczos${fpsD}`, '-crf', String(crf), ...common, `${base}-scrub.mp4`]);
  ff(['-i', input, '-vf', `scale='min(960,iw)':-2:flags=lanczos${fpsM}`, '-crf', String(crf + 3), ...common, `${base}-scrub-m.mp4`]);
  // VP9 twins for browsers built without H.264 (e.g. open-source Chromium); the page picks whichever plays.
  const vp9 = ['-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-g', '6', '-keyint_min', '6', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p'];
  ff(['-i', input, '-vf', `scale='min(${width},iw)':-2:flags=lanczos${fpsD}`, '-crf', '36', ...vp9, `${base}-scrub.webm`]);
  ff(['-i', input, '-vf', `scale='min(960,iw)':-2:flags=lanczos${fpsM}`, '-crf', '38', ...vp9, `${base}-scrub-m.webm`]);
  ff(['-i', input, '-vf', `scale='min(${width},iw)':-2`, '-frames:v', '1', '-q:v', '3', `${base}-poster.jpg`]);
  const d = probeDuration(input);
  ff(['-ss', String(Math.max(0, d - 0.08)), '-i', input, '-vf', `scale='min(${width},iw)':-2`, '-frames:v', '1', '-q:v', '3', `${base}-lastframe.jpg`]);
  record(name, { scrub: true, webm: true });
  console.log(`✔ ${name}: scrub ${size(`${base}-scrub.mp4`)} (+webm ${size(`${base}-scrub.webm`)}), mobile ${size(`${base}-scrub-m.mp4`)}, posters`);
}

// Ambient loop: silent, small, starts instantly; --pingpong plays forward then backward for a seamless loop.
export function loop(input, name, { width = 1280, crf = 25, pingpong = false } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const base = path.join(OUT, name);
  const sc = `scale='min(${width},iw)':-2:flags=lanczos`;
  const vf = pingpong
    ? `${sc},fps=24,split[a][b];[b]reverse,trim=start_frame=1[r];[a][r]concat=n=2:v=1:a=0`
    : `${sc},fps=24`;
  ff(['-i', input, '-an', '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', String(crf), '-movflags', '+faststart', `${base}-loop.mp4`]);
  ff(['-i', input, '-an', '-vf', vf, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', `${base}-loop.webm`]);
  ff(['-i', input, '-vf', `scale='min(${width},iw)':-2`, '-frames:v', '1', '-q:v', '3', `${base}-poster.jpg`]);
  record(name, { loop: true, webm: true });
  console.log(`✔ ${name}: loop ${size(`${base}-loop.mp4`)} + poster`);
}

// Stills: responsive widths as webp (primary) and jpg (fallback).
export function still(input, name, { widths = [640, 1280, 1920, 2560] } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const base = path.join(OUT, name);
  for (const w of widths) {
    ff(['-i', input, '-vf', `scale='min(${w},iw)':-2:flags=lanczos`, '-q:v', '78', '-compression_level', '6', `${base}-${w}.webp`]);
  }
  ff(['-i', input, '-vf', `scale='min(1920,iw)':-2:flags=lanczos`, '-q:v', '4', `${base}.jpg`]);
  record(name, { still: { widths } });
  console.log(`✔ ${name}: ${widths.map((w) => w + 'w').join(', ')} webp + jpg`);
}

function all() {
  const planFile = path.resolve('juried/asset-plan.json');
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const raw = path.resolve(plan.outDir || 'juried/raw');
  const manifest = JSON.parse(fs.readFileSync(path.join(raw, 'manifest.json'), 'utf8'));
  for (const o of plan.outputs || []) {
    const m = manifest[o.from];
    if (!m) { console.warn(`• skip ${o.name}: ${o.from} not generated yet`); continue; }
    const input = path.join(raw, m.file);
    if (o.type === 'scrub') scrub(input, o.name, o);
    else if (o.type === 'loop') loop(input, o.name, o);
    else if (o.type === 'still') still(input, o.name, o);
  }
}

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'all') all();
  else if (cmd === 'scrub') scrub(a, b);
  else if (cmd === 'loop') loop(a, b, { pingpong: process.argv.includes('--pingpong') });
  else if (cmd === 'still') still(a, b);
  else console.log('Usage: node tools/film.mjs all | scrub <in> <name> | loop <in> <name> [--pingpong] | still <in> <name>');
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}
