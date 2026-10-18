#!/usr/bin/env node
// Study a website the person wants to take inspiration from.
//
//   node tools/reference.mjs <url> [<url> ...] [--out juried/references]
//
// For each site: desktop and mobile contact sheets of the whole page, plus facts.json with what makes it
// work, measured in a real browser: typefaces and type scale, colour palette, light or dark, content width,
// section rhythm, button shape, and the motion / 3D stack (GSAP, Lenis, three.js, Spline, Lottie, video,
// WebGL canvases, sticky and pinned sections). These are the qualities to borrow. The site's own logo,
// copy, photography and code are never reused.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = path.resolve(outIdx === -1 ? 'juried/references' : argv[outIdx + 1]);
const urls = [];
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--out') { i++; continue; } if (!argv[i].startsWith('--')) urls.push(argv[i]); }
if (!urls.length) { console.log('Usage: node tools/reference.mjs <url> [<url> ...] [--out juried/references]'); process.exit(1); }

const slugOf = (u) => new URL(u).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

// Runs inside the page: measure the design system as rendered.
const MEASURE = () => {
  const hex = (c) => {
    const m = c && c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m || (m[4] !== undefined && +m[4] < 0.5)) return null;
    return '#' + [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('');
  };
  const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const type = (sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => visible(e) && e.textContent.trim().length > 2);
    if (!el) return null;
    const s = getComputedStyle(el);
    return { sample: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), family: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), stack: s.fontFamily, size: s.fontSize, weight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, transform: s.textTransform };
  };
  const bg = new Map(), fg = new Map(), accents = new Map(), radii = new Map();
  const all = [...document.querySelectorAll('body *')].slice(0, 4000);
  for (const el of all) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const b = hex(s.backgroundColor);
    if (b) bg.set(b, (bg.get(b) || 0) + Math.min(r.width * r.height, 2e6));
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    const f = hex(s.color);
    if (f && own) fg.set(f, (fg.get(f) || 0) + own.length);
    // Buttons: links and buttons that have a filled or outlined shape (not plain text links).
    if (el.matches('a, button, [role=button], input[type=submit]') && r.height > 24 && r.height < 90 && (b || parseFloat(s.borderTopWidth) > 0)) {
      if (b) accents.set(b, (accents.get(b) || 0) + 1);
      radii.set(s.borderRadius, (radii.get(s.borderRadius) || 0) + 1);
    }
  }
  // Body text: the size most of the paragraph text is set in, not the first small label.
  const bodySizes = new Map();
  for (const p of document.querySelectorAll('p')) { if (!visible(p)) continue; const k = getComputedStyle(p).fontSize; bodySizes.set(k, (bodySizes.get(k) || 0) + p.textContent.trim().length); }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  const bodyBg = hex(getComputedStyle(document.body).backgroundColor) || hex(getComputedStyle(document.documentElement).backgroundColor) || top(bg, 1)[0] || '#ffffff';
  const widths = new Map();
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width >= 600 && r.width < innerWidth - 40 && Math.abs(r.left + r.width / 2 - innerWidth / 2) < 4) widths.set(Math.round(r.width), (widths.get(Math.round(r.width)) || 0) + 1);
  }
  const scripts = [...document.scripts].map((s) => s.src).join(' ');
  const html = document.documentElement;
  const has = (re) => re.test(scripts);
  let webgl = 0;
  for (const c of document.querySelectorAll('canvas')) { try { if (c.getContext('webgl2') || c.getContext('webgl')) webgl++; } catch { webgl++; } }
  const stickies = all.filter((el) => ['sticky', 'fixed'].includes(getComputedStyle(el).position)).length;
  return {
    title: document.title,
    description: document.querySelector('meta[name=description]')?.content || '',
    theme: lum(bodyBg) < 0.4 ? 'dark' : 'light',
    type: { h1: type('h1'), h2: type('h2'), h3: type('h3'), body: { ...type('p'), size: top(bodySizes, 1)[0] }, button: type('a[class*=btn], button, a[class*=button]') },
    fontsLoaded: [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')))],
    colors: { background: top(bg, 6), text: top(fg, 5), buttons: top(accents, 3) },
    buttonRadius: top(radii, 2),
    contentWidth: top(widths, 3),
    page: { screens: +(html.scrollHeight / innerHeight).toFixed(1), sections: document.querySelectorAll('section').length, headings: document.querySelectorAll('h2').length },
    stack: {
      gsap: !!window.gsap || has(/gsap/i) || !!document.querySelector('.pin-spacer'), scrollTrigger: !!window.ScrollTrigger || has(/ScrollTrigger/i) || !!document.querySelector('.pin-spacer'),
      lenis: !!window.lenis || !!window.Lenis || html.classList.contains('lenis') || has(/lenis/i),
      locomotive: html.classList.contains('has-scroll-smooth') || has(/locomotive/i),
      three: !!window.THREE || has(/three(\.module)?(\.min)?\.js|three@/i), spline: !!document.querySelector('spline-viewer') || has(/spline/i),
      lottie: !!window.lottie || !!document.querySelector('lottie-player, dotlottie-player') || has(/lottie/i),
      framer: !!document.querySelector('[data-framer-name], [data-framer-component-type]'), webflow: html.hasAttribute('data-wf-page'),
      webglCanvases: webgl, videos: document.querySelectorAll('video').length, stickyOrFixed: stickies,
      scrollSnap: getComputedStyle(html).scrollSnapType !== 'none',
    },
  };
};

async function shootPage(page, name, dir, stops) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const h = page.viewportSize().height;
  const files = [];
  for (let i = 0; i < stops; i++) {
    const y = Math.round(Math.max(0, total - h) * (i / Math.max(1, stops - 1)));
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(900);
    const f = path.join(dir, `${name}-${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: f, timeout: 60000 }).catch(() => {});
    if (fs.existsSync(f)) files.push(f);
  }
  return files;
}

async function sheet(browser, files, cols, out) {
  if (!files.length) return;
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const imgs = files.map((f) => `<img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">`).join('');
  await page.setContent(`<style>body{margin:0;background:#111}main{display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;padding:8px}img{width:100%;display:block}</style><main>${imgs}</main>`);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await page.screenshot({ path: out, fullPage: true, timeout: 120000 });
  await page.close();
}

async function study(browser, url) {
  const dir = path.join(OUT, slugOf(url));
  fs.mkdirSync(dir, { recursive: true });
  const facts = { url, capturedAt: new Date().toISOString() };
  for (const vp of [
    { name: 'desktop', viewport: { width: 1440, height: 900 }, stops: 10, cols: 5 },
    { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, stops: 8, cols: 8 },
  ]) {
    const context = await browser.newContext({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor || 1, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
      if (vp.name === 'desktop') Object.assign(facts, await page.evaluate(MEASURE));
      const files = await shootPage(page, vp.name, dir, vp.stops);
      await sheet(browser, files, vp.cols, path.join(dir, `sheet-${vp.name}.png`));
      for (const f of files) fs.rmSync(f, { force: true });
    } catch (err) {
      facts[`${vp.name}Error`] = String(err.message || err).split('\n')[0];
    }
    await context.close();
  }
  fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify(facts, null, 2));
  return { dir, facts };
}

const describe = (f) => {
  if (!f.type) return `  could not be measured: ${f.desktopError || 'unknown error'}`;
  const t = f.type, s = f.stack || {};
  const stack = Object.entries(s).filter(([, v]) => v === true).map(([k]) => k);
  const px = (v) => (v ? parseFloat(v) : '?');
  return [
    `  ${f.theme} theme, about ${f.page.screens} screens long, ${f.page.sections} sections`,
    `  type: ${t.h1?.family || '?'} ${px(t.h1?.size)}px/${t.h1?.weight} headlines, ${t.body?.family || '?'} ${px(t.body?.size)}px text`,
    `  colours: background ${f.colors.background.slice(0, 3).join(' ')}, text ${f.colors.text.slice(0, 2).join(' ')}, buttons ${f.colors.buttons.join(' ') || '-'}`,
    `  content width ${f.contentWidth[0] || '?'}px, button radius ${f.buttonRadius[0] || '?'}`,
    `  motion and 3D: ${stack.join(', ') || 'none detected'}; ${s.webglCanvases} WebGL canvas(es), ${s.videos} video(s), ${s.stickyOrFixed} sticky/fixed element(s)`,
  ].join('\n');
};

(async () => {
  const args = (process.env.JURIED_CHROME_ARGS || '').split(' ').filter(Boolean);
  let browser;
  if (!process.env.JURIED_CHROME) { try { browser = await chromium.launch({ channel: 'chrome', args }); } catch {} }
  if (!browser) browser = await chromium.launch({ executablePath: process.env.JURIED_CHROME || undefined, args });
  for (const url of urls) {
    const full = /^https?:\/\//.test(url) ? url : `${/^(localhost|127\.)/.test(url) ? 'http' : 'https'}://${url}`;
    process.stdout.write(`• ${full} … `);
    const { dir, facts } = await study(browser, full);
    console.log(`done → ${path.relative(process.cwd(), dir)}`);
    console.log(describe(facts));
  }
  await browser.close();
  console.log('\nNext: look at each sheet-desktop.png and sheet-mobile.png, then write what to borrow (and what not to) in juried/brief.md.');
})().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
