#!/usr/bin/env node
// Brand toolkit: turns any logo (SVG/PNG/JPG/WebP, file or URL) into
//   • a clean traced SVG (for crisp UI use)            -> public/brand/<name>.svg
//   • a signed-distance-field texture (for 3D/WebGL)    -> public/brand/<name>-sdf.png
// and records geometry in juried/brand.json (plus public/juried-brand.json, which the page loads).
//
//   node tools/brand.mjs logo <file-or-url> [--name mark] [--crop x0,y0,x1,y1] [--invert]
//
// --crop takes fractions of the logo's width/height (e.g. 0.66,0,1,1 keeps the right third).
// Renders in Google Chrome (or Playwright's Chromium), so every image format the browser can open works.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };


// SVGs without explicit width/height get a default 300x150 box in browsers, which distorts rasterising.
// Give them a large explicit size that matches their viewBox.
function sizeSvg(svg) {
  const vb = svg.match(/viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)/i);
  if (!vb) return svg;
  const w = +vb[3], h = +vb[4], k = 2400 / Math.max(w, h);
  return svg.replace(/<svg\b([^>]*)>/i, (m, attrs) => `<svg${attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '')} width="${Math.round(w * k)}" height="${Math.round(h * k)}">`);
}

async function launch() {
  // Google Chrome when installed (no extra download), else the Chromium that Playwright installs.
  const exe = process.env.JURIED_CHROME;
  if (!exe) { try { return await chromium.launch({ channel: 'chrome' }); } catch {} }
  try { return await chromium.launch({ executablePath: exe || undefined }); }
  catch (e) { throw new Error(`Could not start a browser (${e.message.split('\n')[0]}). Install Google Chrome, or run: npx playwright install chromium`); }
}

async function logo(src, { name = 'mark', crop, invert = false } = {}) {
  let dataUrl;
  if (/^https?:/i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Download failed ${res.status}: ${src}`);
    const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
    let buf = Buffer.from(await res.arrayBuffer());
    if (type.includes('svg')) buf = Buffer.from(sizeSvg(buf.toString('utf8')));
    dataUrl = `data:${type};base64,${buf.toString('base64')}`;
  } else {
    const ext = path.extname(src).slice(1).toLowerCase();
    const type = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'image/png';
    let buf = fs.readFileSync(src);
    if (type === 'image/svg+xml') buf = Buffer.from(sizeSvg(buf.toString('utf8')));
    dataUrl = `data:${type};base64,${buf.toString('base64')}`;
  }
  const cropBox = crop ? String(crop).split(',').map(Number) : [0, 0, 1, 1];

  const browser = await launch();
  const page = await browser.newPage();
  const out = await page.evaluate(async ({ dataUrl, cropBox, invert }) => {
    const im = new Image(); im.src = dataUrl; await im.decode();
    const iw = im.naturalWidth || 1024, ih = im.naturalHeight || 512;
    // 1) rasterise crop region at high resolution
    const [cx0, cy0, cx1, cy1] = cropBox;
    const sw = (cx1 - cx0) * iw, sh = (cy1 - cy0) * ih;
    const R = 3200 / Math.max(sw, sh);
    const W = Math.round(sw * R), H = Math.round(sh * R);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(im, cx0 * iw, cy0 * ih, sw, sh, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    // 2) decide what "ink" is: alpha if transparent, else contrast against the border colour
    let transparent = false; for (let i = 3; i < px.length; i += 4 * 97) if (px[i] < 250) { transparent = true; break; }
    const lum = (i) => (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
    let border = 0, bn = 0; for (let x = 0; x < W; x++) { border += lum(x * 4); border += lum(((H - 1) * W + x) * 4); bn += 2; }
    border /= bn;
    const cov = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const a = px[i * 4 + 3] / 255;
      let v = transparent ? a : Math.min(1, Math.abs(lum(i * 4) - border) * 2.2);
      if (invert) v = 1 - v; cov[i] = v;
    }
    // 3) tight bounds of the ink
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cov[y * W + x] > 0.5) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // 4) SDF canvas with padding; distances in pixels, Felzenszwalb EDT
    const S = 1024, pad = 0.14;
    const scale = (S * (1 - 2 * pad)) / Math.max(bw, bh);
    const TW = S, TH = Math.max(64, Math.round(S * Math.max(0.35, bh / bw)));
    const ox = (TW - bw * scale) / 2, oy = (TH - bh * scale) / 2;
    const INF = 1e20;
    // Supersample the mask 3x, run an exact Euclidean distance transform (Felzenszwalb), then box-filter
    // back down. The mask is re-drawn straight from the source image at the target resolution, so vector
    // logos stay exact and there is no resampling moiré along diagonal edges.
    const SS = 3, SW = TW * SS, SH = TH * SS;
    const hc = document.createElement('canvas'); hc.width = SW; hc.height = SH;
    const hg = hc.getContext('2d', { willReadFrequently: true });
    hg.imageSmoothingEnabled = true; hg.imageSmoothingQuality = 'high';
    if (!transparent) { const b = Math.round(border * 255); hg.fillStyle = `rgb(${b},${b},${b})`; hg.fillRect(0, 0, SW, SH); }
    hg.drawImage(im, cx0 * iw + x0 / R, cy0 * ih + y0 / R, bw / R, bh / R, ox * SS, oy * SS, bw * scale * SS, bh * scale * SS);
    const hp = hg.getImageData(0, 0, SW, SH).data;
    const hi = new Uint8Array(SW * SH);
    for (let i = 0; i < SW * SH; i++) {
      let v = transparent ? hp[i * 4 + 3] / 255 : Math.min(1, Math.abs((0.299 * hp[i * 4] + 0.587 * hp[i * 4 + 1] + 0.114 * hp[i * 4 + 2]) / 255 - border) * 2.2);
      if (invert) v = 1 - v;
      hi[i] = v > 0.5 ? 1 : 0;
    }
    function edt1(f, n, d, v, z) { let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < n; q++) { let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
      k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; } }
    function edt(mask, want, w, h) { const g2 = new Float32Array(w * h); for (let i = 0; i < w * h; i++) g2[i] = mask[i] === want ? 0 : INF;
      const n = Math.max(w, h); const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
      for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g2[y * w + x]; edt1(f, h, d, v, z); for (let y = 0; y < h; y++) g2[y * w + x] = d[y]; }
      for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g2[y * w + x]; edt1(f, w, d, v, z); for (let x = 0; x < w; x++) g2[y * w + x] = d[x]; }
      return g2; }
    const dOut = edt(hi, 1, SW, SH), dIn = edt(hi, 0, SW, SH);
    const sdHi = new Float32Array(SW * SH);
    for (let i = 0; i < SW * SH; i++) sdHi[i] = (Math.sqrt(dOut[i]) - Math.sqrt(dIn[i])) / SS; // in output texels
    const RANGE = 48; // texels of distance encoded on each side of the edge (coarse channel)
    const oc = document.createElement('canvas'); oc.width = TW; oc.height = TH;
    const og = oc.getContext('2d'); const img = og.createImageData(TW, TH);
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      let acc = 0; for (let j = 0; j < SS; j++) for (let k = 0; k < SS; k++) acc += sdHi[(y * SS + j) * SW + x * SS + k];
      const sd = acc / (SS * SS); // >0 outside, <0 inside
      const i = y * TW + x;
      // 16-bit signed distance (±RANGE texels) split across R (high byte) and G (low byte);
      // B holds an 8-bit copy purely so the PNG is human-viewable. The runtime decodes RG to floats.
      const n = Math.max(0, Math.min(1, 0.5 + (sd / RANGE) * 0.5));
      const v16 = Math.round(n * 65535);
      img.data[i * 4] = v16 >> 8; img.data[i * 4 + 1] = v16 & 255; img.data[i * 4 + 2] = Math.round(n * 255); img.data[i * 4 + 3] = 255;
    }
    og.putImageData(img, 0, 0);
    const sdf = oc.toDataURL('image/png');

    // 5) traced vector outline (marching squares + simplification) of the cropped ink
    const T = 900 / Math.max(bw, bh); const VW = Math.ceil(bw * T) + 2, VH = Math.ceil(bh * T) + 2;
    const val = (x, y) => { const sx = x0 + (x - 1) / T, sy = y0 + (y - 1) / T; const ix = Math.floor(sx), iy = Math.floor(sy); return ix >= 0 && iy >= 0 && ix < W && iy < H ? cov[iy * W + ix] : 0; };
    const iso = 0.5, segs = [], lerp = (a, b) => (iso - a) / (b - a || 1e-6);
    for (let j = 0; j < VH - 1; j++) for (let i = 0; i < VW - 1; i++) {
      const tl = val(i, j), tr = val(i + 1, j), br = val(i + 1, j + 1), bl = val(i, j + 1);
      const idx = (tl > iso ? 8 : 0) | (tr > iso ? 4 : 0) | (br > iso ? 2 : 0) | (bl > iso ? 1 : 0); if (!idx || idx === 15) continue;
      const Tp = [i + lerp(tl, tr), j], Rp = [i + 1, j + lerp(tr, br)], Bp = [i + lerp(bl, br), j + 1], Lp = [i, j + lerp(tl, bl)];
      const m = { 1: [[Lp, Bp]], 2: [[Bp, Rp]], 3: [[Lp, Rp]], 4: [[Tp, Rp]], 6: [[Tp, Bp]], 7: [[Lp, Tp]], 8: [[Lp, Tp]], 9: [[Tp, Bp]], 11: [[Tp, Rp]], 12: [[Lp, Rp]], 13: [[Bp, Rp]], 14: [[Lp, Bp]] };
      const ctr = (tl + tr + br + bl) / 4;
      if (idx === 5) segs.push(...(ctr > iso ? [[Lp, Tp], [Bp, Rp]] : [[Lp, Bp], [Tp, Rp]])); else if (idx === 10) segs.push(...(ctr > iso ? [[Tp, Rp], [Lp, Bp]] : [[Lp, Tp], [Bp, Rp]])); else segs.push(...m[idx]);
    }
    const key = (p) => p[0].toFixed(3) + ',' + p[1].toFixed(3); const adj = new Map();
    segs.forEach((s, k) => { for (const p of s) { const kk = key(p); if (!adj.has(kk)) adj.set(kk, []); adj.get(kk).push(k); } });
    const used = new Uint8Array(segs.length), loops = [];
    for (let k = 0; k < segs.length; k++) { if (used[k]) continue; used[k] = 1; const loop = [segs[k][0], segs[k][1]]; let cur = segs[k][1];
      for (;;) { const nb = (adj.get(key(cur)) || []).find((n) => !used[n]); if (nb === undefined) break; used[nb] = 1; const s = segs[nb]; const nx = key(s[0]) === key(cur) ? s[1] : s[0]; loop.push(nx); cur = nx; }
      if (loop.length > 8) loops.push(loop); }
    const pd = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return L < 1e-9 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L; };
    const rdp = (pts, e) => { if (pts.length < 3) return pts; let dm = 0, id = 0; for (let i = 1; i < pts.length - 1; i++) { const dd = pd(pts[i], pts[0], pts[pts.length - 1]); if (dd > dm) { dm = dd; id = i; } }
      return dm > e ? rdp(pts.slice(0, id + 1), e).slice(0, -1).concat(rdp(pts.slice(id), e)) : [pts[0], pts[pts.length - 1]]; };
    const simp = (l) => { let far = 0, fi = 0; l.forEach((p, i) => { const dd = Math.hypot(p[0] - l[0][0], p[1] - l[0][1]); if (dd > far) { far = dd; fi = i; } }); return rdp(l.slice(0, fi + 1), 0.4).slice(0, -1).concat(rdp(l.slice(fi), 0.4).slice(0, -1)); };
    const f = (n) => String(Math.round(n * 10) / 10);
    const d = loops.map(simp).map((l) => 'M' + l.map((p) => f(p[0] - 1) + ' ' + f(p[1] - 1)).join(' ') + 'Z').join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW - 2} ${VH - 2}"><path fill="currentColor" fill-rule="evenodd" d="${d}"/></svg>`;
    return { sdf, svg, aspect: bw / bh, sdfSize: [TW, TH], glyphInSdf: [ox / TW, oy / TH, (ox + bw * scale) / TW, (oy + bh * scale) / TH], rangePx: RANGE, pxPerSdfTexel: 1 / scale, transparent };
  }, { dataUrl, cropBox, invert: !!invert });
  await browser.close();

  fs.mkdirSync('public/brand', { recursive: true });
  fs.writeFileSync(`public/brand/${name}.svg`, out.svg);
  fs.writeFileSync(`public/brand/${name}-sdf.png`, Buffer.from(out.sdf.split(',')[1], 'base64'));
  fs.mkdirSync('juried', { recursive: true });
  const bf = 'juried/brand.json';
  const brand = fs.existsSync(bf) ? JSON.parse(fs.readFileSync(bf, 'utf8')) : {};
  brand.marks = { ...(brand.marks || {}), [name]: { svg: `/brand/${name}.svg`, sdf: `/brand/${name}-sdf.png`, aspect: +out.aspect.toFixed(4), sdfSize: out.sdfSize, glyphRect: out.glyphInSdf.map((v) => +v.toFixed(4)), sdfRangeTexels: out.rangePx, sdfEncoding: 'rg16', source: src, crop: cropBox } };
  fs.writeFileSync(bf, JSON.stringify(brand, null, 2));
  fs.writeFileSync('public/juried-brand.json', JSON.stringify(brand, null, 2)); // runtime copy the page fetches
  console.log(`✔ ${name}: public/brand/${name}.svg + ${name}-sdf.png (aspect ${out.aspect.toFixed(3)}, sdf ${out.sdfSize.join('×')})`);
}

const [cmd, src] = argv;
if (cmd === 'logo' && src) {
  logo(src, { name: opt('name', 'mark'), crop: opt('crop', null), invert: opt('invert', false) }).catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
} else {
  console.log('Usage: node tools/brand.mjs logo <file-or-url> [--name mark] [--crop x0,y0,x1,y1] [--invert]');
}
