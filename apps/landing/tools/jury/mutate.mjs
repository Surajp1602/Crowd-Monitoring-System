#!/usr/bin/env node
// Jury calibration by mutation testing.
//
//   node tools/jury/mutate.mjs [--url http://localhost:4173] [--out juried/jury/calibration]
//        -> renders the built site plus deliberately degraded copies ("mutants"), each as a contact sheet
//           with a blind label (A, B, C…). The mapping is written to key.json, which the juror never sees.
//   node tools/jury/mutate.mjs --score juried/jury/calibration/scores.json
//        -> checks the juror's blind scores against the key. The jury counts as calibrated only if it
//           scores the real build above every mutant, by a margin on the dimension each mutant attacks.
//
// Why: a vision jury that cannot tell a site from its own broken copies is rubber-stamping, and a build loop
// that optimises against a rubber stamp learns nothing. Calibrate once per project before trusting scores.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const OUT = path.resolve(opt('out', 'juried/jury/calibration'));

// Each mutant attacks one quality the rubric claims to measure.
const MUTANTS = {
  original: { attacks: null, css: '', js: null },
  'generic-type': {
    attacks: 'design',
    css: `*, *::before, *::after { font-family: Arial, Helvetica, sans-serif !important; letter-spacing: normal !important; font-weight: 400 !important; }
          h1, h2, h3 { font-weight: 700 !important; }`,
  },
  'template-palette': {
    attacks: 'design',
    css: `html, body, section, header, footer, main, div { background: #ffffff !important; background-image: none !important; color: #1f2937 !important; }
          a, button { color: #2563eb !important; }
          .btn, [class*="btn"], button { background: #3b82f6 !important; color: #fff !important; border-radius: 6px !important; }`,
  },
  'no-signature': {
    attacks: 'creativity',
    css: `canvas, video { visibility: hidden !important; }
          [style*="background-image"] { background-image: none !important; }
          img:not([src$=".svg"]) { visibility: hidden !important; }`,
  },
  'cramped-broken': {
    attacks: 'usability',
    css: `section, header, footer { padding: 0.4rem !important; margin: 0 !important; }
          h1, h2 { font-size: 1.1rem !important; line-height: 1 !important; transform: translateX(-24px); }
          p, li { font-size: 11px !important; line-height: 1.05 !important; max-width: none !important; }
          * { gap: 2px !important; }`,
  },
  'lorem-content': {
    attacks: 'content',
    js: () => {
      const L = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore';
      const swap = () => document.querySelectorAll('h1, h2, h3, p, li, dd, dt, .btn, a').forEach((el) => {
        if (el.children.length > 2) return;
        const n = (el.textContent || '').trim().split(/\s+/).length;
        if (n) el.textContent = L.split(' ').slice(0, Math.max(1, Math.min(n, 16))).join(' ');
      });
      addEventListener('load', () => setTimeout(swap, 400));
    },
  },
};

async function serve() {
  if (opt('url')) return { url: opt('url'), stop: () => {} };
  const port = 4600 + Math.floor(Math.random() * 300);
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json', { paths: [process.cwd()] })), 'bin', 'vite.js');
  const vite = spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return { url, stop: () => vite.kill() };
}

async function launch() {
  const args = process.env.JURIED_GL === 'swiftshader' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'];
  if (!process.env.JURIED_CHROME) { try { return await chromium.launch({ channel: 'chrome', args }); } catch {} }
  return chromium.launch({ executablePath: process.env.JURIED_CHROME || undefined, args });
}

async function shoot(browser, url, name, m) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (m.js) await ctx.addInitScript(m.js);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).catch(() => {});
  if (m.css) await page.addStyleTag({ content: m.css });
  await page.waitForTimeout(2500);
  const H = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const shots = [];
  for (const f of [0, 0.18, 0.42, 0.7]) {
    await page.evaluate((y) => { window.__lenis?.scrollTo?.(y, { immediate: true }); window.scrollTo(0, y); }, Math.round(H * f));
    await page.waitForTimeout(600);
    // Every variant gets the same chance: wait for images now in view to finish loading (lazy loading).
    await page.evaluate(() => new Promise((done) => {
      const pending = [...document.images].filter((i) => { const b = i.getBoundingClientRect(); return !i.complete && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth; });
      let n = pending.length; if (!n) return done();
      pending.forEach((i) => { const f = () => { if (--n <= 0) done(); }; i.addEventListener('load', f, { once: true }); i.addEventListener('error', f, { once: true }); });
      setTimeout(done, 8000);
    }));
    await page.waitForTimeout(600);
    shots.push((await page.screenshot({ type: 'jpeg', quality: 80 })).toString('base64'));
  }
  await ctx.close();
  return shots;
}

async function sheet(browser, shots, file) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.setContent(`<style>body{margin:0;background:#111}main{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px}img{width:100%;display:block}</style><main>${shots.map((b) => `<img src="data:image/jpeg;base64,${b}">`).join('')}</main>`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await page.screenshot({ path: file, fullPage: true, timeout: 120000 });
  await page.close();
}

function score(file) {
  const key = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'key.json'), 'utf8'));
  const scores = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byVariant = Object.fromEntries(Object.entries(key).map(([label, variant]) => [variant, scores[label]]));
  const orig = byVariant.original;
  if (!orig) throw new Error('scores.json has no score for the original build (check the labels)');
  const results = Object.entries(byVariant).filter(([v]) => v !== 'original').map(([v, s]) => {
    const dim = MUTANTS[v].attacks;
    const overallGap = +(orig.overall - s.overall).toFixed(2);
    const dimGap = +(orig[dim] - s[dim]).toFixed(2);
    return { mutant: v, attacks: dim, overallGap, dimGap, caught: overallGap >= 0.5 && dimGap >= 1.0 };
  });
  const caught = results.filter((r) => r.caught).length;
  const verdict = { calibrated: caught === results.length, caught, total: results.length, results };
  fs.writeFileSync(path.join(path.dirname(file), 'result.json'), JSON.stringify(verdict, null, 2));
  console.log(`\nJury calibration: caught ${caught}/${results.length} mutants`);
  for (const r of results) console.log(`${r.caught ? '✔' : '✖'} ${r.mutant.padEnd(16)} overall gap ${r.overallGap}, ${r.attacks} gap ${r.dimGap}`);
  console.log(verdict.calibrated ? '\nCalibrated: the jury\'s scores can steer the build.\n' : '\nNOT calibrated: treat vision scores as advisory; rely on the deterministic gates and re-run with a stricter juror prompt.\n');
  process.exitCode = verdict.calibrated ? 0 : 4;
}

(async () => {
  if (opt('score')) return score(path.resolve(opt('score')));
  fs.mkdirSync(path.join(OUT, 'sheets'), { recursive: true });
  const { url, stop } = await serve();
  const browser = await launch();
  const names = Object.keys(MUTANTS);
  // Blind labels in a shuffled order so position gives nothing away.
  const order = [...names].sort(() => Math.random() - 0.5);
  const key = {};
  try {
    for (let i = 0; i < order.length; i++) {
      const label = String.fromCharCode(65 + i);
      process.stdout.write(`• sheet ${label}… `);
      await sheet(browser, await shoot(browser, url, order[i], MUTANTS[order[i]]), path.join(OUT, 'sheets', `${label}.png`));
      key[label] = order[i];
      console.log('done');
    }
  } finally { await browser.close(); stop(); }
  fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 2));
  fs.writeFileSync(path.join(OUT, 'scores.template.json'), JSON.stringify(Object.fromEntries(Object.keys(key).map((l) => [l, { design: 0, usability: 0, creativity: 0, content: 0, overall: 0 }])), null, 2));
  console.log(`\n${order.length} blind sheets → ${path.relative(process.cwd(), path.join(OUT, 'sheets'))}`);
  console.log('Give ONLY the sheets folder to the juror (never key.json). Save its scores as scores.json in the same shape as scores.template.json, then run:');
  console.log(`  node tools/jury/mutate.mjs --score ${path.relative(process.cwd(), path.join(OUT, 'scores.json'))}\n`);
})();
