#!/usr/bin/env node
// Jury capture: renders the built site in a real browser and measures it.
//
//   node tools/jury/capture.mjs [--url http://localhost:4173 | https://any-site.com] [--out juried/jury/<stamp>] [--quick] [--headed]
//
// Produces screenshots at desktop + mobile, a contact sheet for the vision jury, and report.json with
// deterministic gate results (console errors, layout overflow, CLS/LCP, frame rate while scrolling,
// accessibility violations, whether every canvas/video actually painted, and link parity with the
// original site). Uses the Chromium Playwright installs (JURIED_CHROME overrides the executable).

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.resolve(opt('out', `juried/jury/${stamp}`));
const QUICK = !!opt('quick', false);
const EXTERNAL = !!opt('url') && !/localhost|127\.0\.0\.1/.test(String(opt('url')));
const GATES = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./gates.json', import.meta.url)), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

async function serve() {
  if (opt('url')) return { url: opt('url'), stop: () => {} };
  const port = 4173 + Math.floor(Math.random() * 400);
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json', { paths: [process.cwd()] })), 'bin', 'vite.js');
  const vite = spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(url); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  return { url, stop: () => vite.kill() };
}

const INIT = () => {
  window.__metrics = { cls: 0, lcp: 0, longTasks: 0 };
  try {
    window.__metrics.shifts = [];
    const describe = (n) => !n ? '?' : n.nodeType !== 1 ? (n.parentElement ? describe(n.parentElement) + ' > text' : 'text') : n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__metrics.cls += e.value;
        if (e.value > 0.01) window.__metrics.shifts.push({ value: +e.value.toFixed(3), at: Math.round(e.startTime), y: Math.round(scrollY), sources: (e.sources || []).slice(0, 3).map((s) => describe(s.node)) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { if (window.__lcpFrozen) return; const e = l.getEntries().at(-1); if (e) { window.__metrics.lcp = e.renderTime || e.loadTime || e.startTime; window.__metrics.lcpElement = e.element ? (e.element.tagName.toLowerCase() + (e.element.className && typeof e.element.className === 'string' ? '.' + e.element.className.split(' ')[0] : '')) : '?'; } }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { window.__metrics.longTasks += l.getEntries().filter((e) => e.duration > 200).length; }).observe({ type: 'longtask', buffered: true });
  } catch {}
};

function variance(buf) {
  const png = PNG.sync.read(buf);
  let n = 0, s = 0, s2 = 0;
  for (let i = 0; i < png.data.length; i += 16) { const v = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3; n++; s += v; s2 += v * v; }
  const m = s / n; return { mean: m, std: Math.sqrt(Math.max(0, s2 / n - m * m)) };
}

async function runViewport(browser, url, vp) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr || 1, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, reducedMotion: vp.reducedMotion ? 'reduce' : 'no-preference' });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const errors = [], failed = [];
  // Third-party requests that fail (a hotlinked logo, an embedded widget) are reported, not gated:
  // they are outside the site's control. Everything first-party must be clean.
  const origin = new URL(url).origin;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const src = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && src && !src.startsWith(origin)) return;
    errors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
  page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText || 'failed'} ${r.url().slice(0, 160)}`));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 160)}`); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Juried pages signal window.__ready; any other site (judging a live URL) just needs to finish loading.
  if (EXTERNAL) await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
  else await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).catch(() => errors.push('page never signalled window.__ready'));
  await page.waitForTimeout(QUICK ? 1500 : 4000);

  const shots = [];
  await page.evaluate(() => { window.__lcpFrozen = true; }); // LCP = the first screen; scrolling reveals later content
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const stops = vp.stops || 14;
  for (let i = 0; i < stops; i++) {
    const y = Math.round((total - vp.height) * (i / (stops - 1)));
    await page.evaluate((yy) => { window.__lenis?.scrollTo?.(yy, { immediate: true }); window.scrollTo(0, yy); }, y);
    await page.waitForTimeout(QUICK ? 700 : 1300); // let count-ups and reveals land before the still
    const file = path.join(OUT, `${vp.name}-${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    shots.push({ file: path.basename(file), y });
  }

  // Did every canvas and video actually paint something? (catches blank WebGL and missing media)
  const paint = [];
  const els = await page.$$('canvas, video');
  for (const el of els) {
    // Elements deliberately hidden (e.g. a video replaced by its designed fallback) are not blank paint.
    const shown = await el.evaluate((n) => (n.checkVisibility ? n.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true));
    const box = shown ? await el.boundingBox() : null;
    const name = await el.evaluate((n) => n.dataset.liquid !== undefined ? 'hero-liquid' : n.dataset.orbit !== undefined ? 'orbit-hub' : n.dataset.liquidCta !== undefined ? 'cta-liquid' : n.tagName.toLowerCase() + (n.closest('[data-media]')?.dataset.media ? ':' + n.closest('[data-media]').dataset.media : n.closest('section')?.className ? ':' + n.closest('section').className.split(' ')[0] : ''));
    if (!box || box.width < 40 || box.height < 40) { paint.push({ name, visible: false }); continue; }
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(QUICK ? 600 : 1500);
    const buf = await el.screenshot().catch(() => null);
    paint.push({ name, visible: true, ...(buf ? variance(buf) : { std: 0 }) });
  }

  // Frame rate during a scripted scroll through the whole page
  const fps = await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
    const H = document.documentElement.scrollHeight - innerHeight;
    const frames = [], at = []; let last = performance.now(); const t0 = last;
    await new Promise((resolve) => {
      const step = (now) => {
        frames.push(now - last); at.push(scrollY + innerHeight / 2); last = now;
        const p = Math.min(1, (now - t0) / 6000);
        window.scrollTo(0, H * p);
        if (p < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    frames.shift(); at.shift();
    const sorted = [...frames].sort((a, b) => a - b);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    // Attribute each frame to the section under the middle of the screen.
    const secs = [...document.querySelectorAll('main > section, body > footer, main > footer')].map((el) => {
      const r = el.getBoundingClientRect();
      return { name: (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName.toLowerCase()), top: r.top + scrollY, bottom: r.bottom + scrollY };
    });
    const per = {};
    frames.forEach((dt, i) => { const s = secs.find((x) => at[i] >= x.top && at[i] < x.bottom); const k = s ? s.name : 'other'; (per[k] ||= []).push(dt); });
    const all = Object.entries(per).map(([k, v]) => ({ section: k, fps: Math.round(1000 / (v.reduce((a, b) => a + b, 0) / v.length)), frames: v.length }));
    const solid = all.filter((x) => x.frames >= 3); // ignore sections the scroll only grazed
    const bySection = (solid.length ? solid : all).sort((a, b) => a.fps - b.fps);
    return { avgFps: Math.round(1000 / avg), p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)]), frames: frames.length, slowest: bySection.slice(0, 3) };
  });

  // Accessibility (axe-core) and layout overflow
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'], runOnly: ['wcag2a', 'wcag2aa'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' '), why: (n.failureSummary || '').split('\n').slice(1, 2).join(' ').slice(0, 160) })) }));
  });
  const layout = await page.evaluate(() => {
    // Unreplaced copy slots, TODOs and lorem ipsum anywhere a visitor could read them.
    const text = document.body.innerText || '';
    const leftovers = [...text.matchAll(/\{\{[^}]{0,40}\}?\}?|\bTODO\b|\bTBD\b|lorem ipsum|dolor sit amet/gi)].slice(0, 8).map((m) => m[0]);
    // Juried sites are React apps: the page must be rendered by React into #root.
    const root = document.getElementById('root');
    const react = !!root && Object.keys(root).some((k) => k.startsWith('__reactContainer')) && root.childElementCount > 0;
    return { overflowX: document.documentElement.scrollWidth - innerWidth, metrics: window.__metrics, links: [...document.querySelectorAll('a[href]')].map((a) => a.href), leftovers, react };
  });

  await context.close();
  return { viewport: vp.name, url, shots, errors, failed: [...new Set(failed)], paint, fps, axe, overflowX: layout.overflowX, metrics: layout.metrics, links: [...new Set(layout.links)], leftovers: layout.leftovers, react: layout.react };
}

async function contactSheet(browser, results) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  for (const r of results) {
    const cols = r.viewport.startsWith('mobile') ? 7 : 4;
    const imgs = r.shots.map((s) => `<figure><img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, s.file)).toString('base64')}"><figcaption>${s.file}</figcaption></figure>`).join('');
    await page.setContent(`<style>body{margin:0;background:#111;font:12px system-ui;color:#999}main{display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;padding:10px}img{width:100%;display:block}figure{margin:0}</style><main>${imgs}</main>`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    await page.screenshot({ path: path.join(OUT, `sheet-${r.viewport}.png`), fullPage: true, timeout: 120000 });
  }
  await page.close();
}

function gate(results) {
  const g = [];
  const add = (id, pass, detail) => g.push({ id, pass, detail });
  const warn = (id, detail) => g.push({ id, pass: true, warning: true, detail });
  for (const r of results) {
    const v = r.viewport;
    add(`${v}: no console errors`, r.errors.length <= GATES.maxConsoleErrors, r.errors.slice(0, 5));
    const third = r.failed.filter((f) => !f.includes(new URL(r.url).origin) && !/ERR_ABORTED/.test(f));
    if (third.length) warn(`${v}: third-party resources failed to load (not gated)`, third.slice(0, 6));
    add(`${v}: no horizontal overflow`, r.overflowX <= 1, `${r.overflowX}px`);
    add(`${v}: layout stable (CLS)`, r.metrics.cls <= GATES.maxCLS, r.metrics.cls.toFixed(3));
    add(`${v}: LCP`, r.metrics.lcp <= GATES.maxLCPms, `${Math.round(r.metrics.lcp)} ms`);
    if (!v.includes('reduced')) add(`${v}: smooth scrolling`, r.fps.avgFps >= (v.startsWith('mobile') ? GATES.minFpsMobile : GATES.minFpsDesktop), r.fps);
    const serious = r.axe.filter((x) => ['serious', 'critical'].includes(x.impact));
    add(`${v}: accessibility (no serious/critical)`, serious.length === 0, serious);
    if (!v.includes('reduced')) add(`${v}: no template leftovers`, !r.leftovers?.length, r.leftovers);
    const blank = r.paint.filter((p) => p.visible && p.std < GATES.minPaintStd);
    add(`${v}: every canvas/video painted`, blank.length === 0, blank.map((b) => `${b.name} std=${b.std?.toFixed(1)}`));
  }
  // Framework: a Juried build must be the React app from the template, never a hand-written HTML page.
  if (!EXTERNAL) {
    const pkg = fs.existsSync('package.json') ? JSON.parse(fs.readFileSync('package.json', 'utf8')) : {};
    const hasReact = !!(pkg.dependencies?.react && pkg.dependencies?.['react-dom']);
    const notReact = results.filter((r) => !r.react).map((r) => r.viewport);
    add('framework: React app', hasReact && notReact.length === 0, hasReact ? (notReact.length ? `not rendered by React in: ${notReact.join(', ')}` : 'React renders #root') : 'package.json has no react / react-dom dependency');
  }
  // Functionality parity: every link the original homepage offered must still be reachable.
  const req = fs.existsSync('juried/research.json') ? JSON.parse(fs.readFileSync('juried/research.json', 'utf8')).mustKeepLinks || [] : [];
  if (req.length) {
    const have = new Set(results.flatMap((r) => r.links).map((u) => u.replace(/\/$/, '')));
    const missing = req.filter((u) => !have.has(u.replace(/\/$/, '')));
    add('functionality: original links retained', missing.length === 0, missing.length ? missing : `${req.length}/${req.length}`);
  }
  return g;
}

(async () => {
  const { url, stop } = await serve();
  // Prefer the real Google Chrome when installed (hardware video decode, GPU); fall back to Playwright's Chromium.
  const args = process.env.JURIED_GL === 'swiftshader' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  const headless = !opt('headed', false);
  let browser, browserName = 'chromium';
  if (!process.env.JURIED_CHROME) {
    try { browser = await chromium.launch({ channel: 'chrome', headless, args }); browserName = 'chrome'; } catch {}
  }
  if (!browser) browser = await chromium.launch({ executablePath: process.env.JURIED_CHROME || undefined, headless, args });
  const vps = [
    { name: 'desktop', width: 1440, height: 900, stops: QUICK ? 8 : 16 },
    { name: 'mobile', width: 390, height: 844, dpr: 2, mobile: true, stops: QUICK ? 8 : 14 },
    { name: 'desktop-reduced', width: 1440, height: 900, reducedMotion: true, stops: 6 },
  ];
  const results = [];
  try {
    for (const vp of vps) { process.stdout.write(`• ${vp.name}… `); results.push(await runViewport(browser, url, vp)); console.log('done'); }
    await contactSheet(browser, results.filter((r) => !r.viewport.includes('reduced')));
  } finally { await browser.close(); stop(); }
  const all = gate(results);
  const gates = all.filter((x) => !x.warning), warnings = all.filter((x) => x.warning);
  const passed = gates.filter((x) => x.pass).length;
  const report = { url, browser: browserName, at: new Date().toISOString(), gates, warnings, passed, total: gates.length, results };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nJury capture (${browserName}) → ${path.relative(process.cwd(), OUT)}`);
  for (const x of gates) console.log(`${x.pass ? '✔' : '✖'} ${x.id}${x.pass ? '' : `  ${JSON.stringify(x.detail).slice(0, 200)}`}`);
  for (const x of warnings) console.log(`! ${x.id}  ${JSON.stringify(x.detail).slice(0, 200)}`);
  console.log(`\nDeterministic gates: ${passed}/${gates.length} passed. Contact sheets: sheet-desktop.png, sheet-mobile.png`);
  process.exitCode = passed === gates.length ? 0 : 3;
})();
