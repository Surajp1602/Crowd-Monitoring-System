#!/usr/bin/env node
// Bring your own photos and video (zero config; ffmpeg only for measuring).
//
//   node tools/import-media.mjs <folder or files...>   -> copy into juried/raw, record them, suggest roles
//        [--no-plan]   do not touch juried/asset-plan.json
//
// Works with any folder of images and clips, and with the juried/raw folder of an earlier Juried project
// (its manifest.json and prompts are kept). Imported media are never regenerated: `npm run assets` skips
// any id already in the manifest, and a generated clip can use an imported photo as its first frame.
// Next: check the suggested roles in juried/asset-plan.json "outputs", then `npm run media`.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.tif', '.tiff', '.bmp']);
const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);
const RAW = path.resolve('juried/raw');
const PLAN = path.resolve('juried/asset-plan.json');

function ffmpegBin() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch {}
  return 'ffmpeg';
}

// Width, height and duration from ffmpeg's banner (no ffprobe needed).
function measure(file) {
  const r = spawnSync(ffmpegBin(), ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const err = r.stderr || '';
  const d = err.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  const s = err.match(/Video: [^\n]*?[ ,](\d{2,5})x(\d{2,5})[\s,[]/);
  return {
    width: s ? +s[1] : null,
    height: s ? +s[2] : null,
    duration: d ? +((+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3])).toFixed(2) : null,
  };
}

function walk(p, depth = 0, out = []) {
  const st = fs.statSync(p);
  if (st.isFile()) { out.push(p); return out; }
  if (depth > 3) return out;
  for (const name of fs.readdirSync(p)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    walk(path.join(p, name), depth + 1, out);
  }
  return out;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'media';

const args = process.argv.slice(2);
const noPlan = args.includes('--no-plan');
const inputs = args.filter((a) => !a.startsWith('--'));
if (!inputs.length) {
  console.log('Usage: node tools/import-media.mjs <folder or files...> [--no-plan]');
  process.exit(1);
}

fs.mkdirSync(RAW, { recursive: true });
const manifestFile = path.join(RAW, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};

// An earlier Juried project's raw folder carries its own manifest: keep each file's prompt and model.
const previous = new Map();
for (const input of inputs) {
  const m = path.join(path.resolve(input), 'manifest.json');
  if (fs.existsSync(m)) {
    try { for (const [id, e] of Object.entries(JSON.parse(fs.readFileSync(m, 'utf8')))) if (e?.file) previous.set(e.file, { id, ...e }); } catch {}
  }
}

const files = [];
for (const input of inputs) {
  if (!fs.existsSync(input)) { console.error(`✖ Not found: ${input}`); process.exit(1); }
  files.push(...walk(path.resolve(input)));
}

const imported = [];
let skipped = 0;
for (const src of files) {
  const ext = path.extname(src).toLowerCase();
  const kind = IMAGE.has(ext) ? 'image' : VIDEO.has(ext) ? 'video' : null;
  if (!kind) { if (path.basename(src) !== 'manifest.json') skipped++; continue; }
  const prev = previous.get(path.basename(src));
  let id = prev?.id || slug(path.basename(src, path.extname(src)));
  // Another file already holds this id (a generation, or a different photo): take the next free one.
  // Re-importing the same file keeps its id, so running this twice is harmless.
  const mine = (e) => e.from === path.basename(src) || (e.file && path.resolve(RAW, e.file) === path.resolve(src));
  for (let n = 2, base = id; manifest[id] && !mine(manifest[id]); n++) id = `${base}-${n}`;
  const file = `${id}${ext === '.jpeg' ? '.jpg' : ext}`;
  const dest = path.join(RAW, file);
  if (path.resolve(src) !== dest) fs.copyFileSync(src, dest);
  const size = measure(dest);
  if (kind === 'image') delete size.duration;
  const { id: _i, file: _f, ...kept } = prev || {};
  manifest[id] = { ...kept, file, kind, ...size, source: prev ? 'earlier-juried' : 'provided', from: path.basename(src), at: prev?.at || Date.now() };
  imported.push({ id, kind, ...size });
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

if (!imported.length) {
  console.error(`✖ No images or videos found (${skipped} other files skipped). Supported: ${[...IMAGE, ...VIDEO].join(' ')}`);
  process.exit(1);
}

// Suggested roles. The longest landscape clip of 4 s or more becomes the scroll-scrubbed film, other clips
// become living loops, and every image a responsive still. The build then checks these against the brief.
const videos = imported.filter((m) => m.kind === 'video').sort((a, b) => (b.duration || 0) - (a.duration || 0));
const film = videos.find((v) => (v.duration || 0) >= 4 && (v.width || 0) >= (v.height || 0));
const role = (m) => (m === film ? 'film (scroll-scrubbed)' : m.kind === 'video' ? 'loop' : 'still');

let added = 0;
if (!noPlan) {
  const plan = fs.existsSync(PLAN)
    ? JSON.parse(fs.readFileSync(PLAN, 'utf8'))
    : { project: path.basename(process.cwd()), outDir: 'juried/raw', budgetUSD: 15, assets: [], outputs: [] };
  plan.assets ||= [];
  plan.outputs ||= [];
  const used = new Set(plan.outputs.map((o) => o.from));
  for (const m of imported) {
    if (used.has(m.id)) continue;
    const type = m === film ? 'scrub' : m.kind === 'video' ? 'loop' : 'still';
    const o = { type, from: m.id, name: m === film ? 'film' : m.id };
    if (type === 'loop') o.pingpong = true;
    plan.outputs.push(o);
    added++;
  }
  fs.mkdirSync(path.dirname(PLAN), { recursive: true });
  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2));
}

const fmt = (m) => `${m.width || '?'}×${m.height || '?'}${m.kind === 'video' ? `, ${m.duration ?? '?'} s` : ''}`;
console.log(`\nImported ${imported.length} file${imported.length > 1 ? 's' : ''} into juried/raw${skipped ? ` (${skipped} non-media files skipped)` : ''}:`);
for (const m of imported) console.log(`  • ${m.id.padEnd(24)} ${m.kind.padEnd(6)} ${fmt(m).padEnd(22)} → ${role(m)}`);
if (previous.size) console.log('\nThese come from an earlier Juried project: each keeps the prompt that describes it.');
if (!noPlan) console.log(`\n${added} suggested output${added === 1 ? '' : 's'} added to juried/asset-plan.json. Check each role and name against the brief.`);
console.log('Next: npm run media   (then npm run assets:dry if the brief still needs shots you do not have)');
