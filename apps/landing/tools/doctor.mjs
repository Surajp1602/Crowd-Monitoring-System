#!/usr/bin/env node
// Preflight: checks everything the pipeline needs and says exactly how to fix what's missing.
//
//   node tools/doctor.mjs            -> human-readable checklist (exit 0 when the site can be built)
//   node tools/doctor.mjs --json     -> machine-readable result for the agent
//
// Never prints secrets: credentials are reported as present/absent and accepted/rejected only.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSON_OUT = process.argv.includes('--json');
const MACHINE = process.argv.includes('--machine'); // before a project exists: only check this computer
const checks = [];
const add = (id, ok, detail, fix = '') => checks.push({ id, ok, detail, fix });
const win = process.platform === 'win32';

// 1. Node
const [maj, min] = process.versions.node.split('.').map(Number);
const nodeOk = (maj === 20 && min >= 19) || (maj === 22 && min >= 12) || maj > 22;
add('node', nodeOk, `Node ${process.versions.node}`, 'Install Node.js 22 LTS from https://nodejs.org, then open a new terminal.');

// 2. Dependencies
if (!MACHINE) {
  const deps = ['vite', 'three', 'gsap', 'lenis', 'playwright', 'axe-core', 'pngjs'];
  const missing = deps.filter((d) => !fs.existsSync(path.join(process.cwd(), 'node_modules', d, 'package.json')));
  add('packages', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : 'all installed', 'Run: npm install');
}

// 3. ffmpeg (for turning generated clips into web video; a project installs its own via ffmpeg-static)
let ff = process.env.FFMPEG_PATH || null;
if (!ff) { try { ff = require('ffmpeg-static'); } catch {} }
ff = ff || 'ffmpeg';
const ffr = spawnSync(ff, ['-hide_banner', '-version'], { encoding: 'utf8' });
const ffOk = ffr.status === 0;
const vp9 = ffOk && spawnSync(ff, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout?.includes('libvpx-vp9');
if (!MACHINE || ffOk) add('ffmpeg', ffOk, ffOk ? `${(ffr.stdout || '').split('\n')[0].slice(0, 60)}${vp9 ? '' : ' (no VP9 encoder: WebM twins will be skipped)'}` : 'not found', 'Run: npm install ffmpeg-static   (or install ffmpeg and add it to PATH)');

// 4. A browser for the jury and the logo tools
let browserOk = false, browserName = '';
try {
  const { chromium } = await import('playwright');
  for (const o of [{ channel: 'chrome' }, { executablePath: process.env.JURIED_CHROME || undefined }]) {
    try { const b = await chromium.launch(o); browserName = o.channel ? 'Google Chrome' : 'Playwright Chromium'; await b.close(); browserOk = true; break; } catch {}
  }
} catch {
  // No Playwright yet (machine check before a project exists): look for Google Chrome where it installs.
  const candidates = win ? [`${process.env['PROGRAMFILES']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/opt/google/chrome/chrome'];
  const found = candidates.find((c) => c && fs.existsSync(c));
  if (found) { browserOk = true; browserName = 'Google Chrome'; }
}
add('browser', browserOk, browserOk ? browserName : 'no browser Playwright can drive', 'Run: npx playwright install chromium');

// 5. Higgsfield (optional: without it the site uses WebGL + typography + any photos you provide)
const e = process.env;
const key = e.HF_KEY || e.HF_CREDENTIALS || (e.HF_API_KEY_ID && e.HF_API_KEY_SECRET ? `${e.HF_API_KEY_ID}:${e.HF_API_KEY_SECRET}` : null) || (e.HF_API_KEY && e.HF_API_SECRET ? `${e.HF_API_KEY}:${e.HF_API_SECRET}` : null);
const setKeyFix = win
  ? 'In PowerShell (not in chat): setx HF_API_KEY_ID "<key id>"  and  setx HF_API_KEY_SECRET "<secret>", then open a NEW terminal and restart Claude.'
  : 'In your shell profile (not in chat): export HF_API_KEY_ID="<key id>"; export HF_API_KEY_SECRET="<secret>", then open a new terminal and restart Claude.';
add('higgsfield-key', !!key, key ? 'credentials present' : 'no credentials in environment', setKeyFix);
let hfReach = false, hfAuth = 'unknown';
if (key) {
  try {
    const ctl = AbortSignal.timeout(12000);
    // Status lookup of a request that cannot exist: costs nothing, but tells us whether the key is rejected.
    const r = await fetch(`${e.HF_BASE_URL || 'https://api.higgsfield.ai'}/requests/00000000-0000-4000-8000-000000000000/status`, { headers: { Authorization: `Key ${key.trim()}`, Accept: 'application/json' }, signal: ctl });
    const body = await r.text().catch(() => '');
    // Corporate/sandbox proxies answer 403/407 in plain text; only Higgsfield's own JSON 401/403 means a bad key.
    if (!/json/i.test(r.headers.get('content-type') || '') && (r.status === 403 || r.status === 407 || /allowlist|proxy|blocked|firewall/i.test(body))) {
      hfAuth = 'unknown (a network proxy blocked the request)';
    } else {
      hfReach = true;
      hfAuth = r.status === 401 || r.status === 403 ? 'rejected' : 'not rejected';
    }
  } catch (err) { hfAuth = `unreachable (${err.cause?.code || err.name})`; }
  add('higgsfield-api', hfReach && hfAuth !== 'rejected', `api.higgsfield.ai ${hfReach ? 'reachable' : 'unreachable'}, key ${hfAuth}`,
    !hfReach ? 'This network blocks api.higgsfield.ai: run the asset step from your own computer/terminal.' : 'Create a new API key in your Higgsfield account (API keys page), set it again, open a new terminal.');
}

const core = checks.filter((c) => !c.id.startsWith('higgsfield'));
const ready = core.every((c) => c.ok);
const gen = checks.filter((c) => c.id.startsWith('higgsfield')).every((c) => c.ok) && checks.some((c) => c.id === 'higgsfield-api');
const verdict = !ready ? 'NOT READY: fix the items marked ✖ first.'
  : gen ? 'READY: full pipeline (research, film generation, build, jury).'
  : key && !hfReach ? 'READY, BUT GENERATION MUST RUN ELSEWHERE: this network cannot reach Higgsfield. The agent prepares the asset plan; you run "npm run assets" in your own terminal.'
  : 'READY WITHOUT GENERATION: the site will use real-time 3D, typography and any photos you supply. Add a Higgsfield key for AI photography and film.';

if (JSON_OUT) {
  console.log(JSON.stringify({ ready, generation: gen, verdict, checks }, null, 2));
} else {
  console.log('\nJuried doctor\n');
  for (const c of checks) console.log(`${c.ok ? '✔' : c.id.startsWith('higgsfield') ? '!' : '✖'} ${c.id.padEnd(15)} ${c.detail}${c.ok ? '' : `\n  → ${c.fix}`}`);
  console.log(`\n${verdict}\n`);
}
process.exitCode = ready ? 0 : 1;
