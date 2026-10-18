#!/usr/bin/env node
// Higgsfield asset runner (zero dependencies, Node 18+).
//
//   node tools/hf.mjs check                       -> verify credentials are set (no spend)
//   node tools/hf.mjs smoke                       -> one tiny image request (~$0.01) to prove the key works
//   node tools/hf.mjs run juried/asset-plan.json  -> generate every asset in the plan (resumable)
//        [--only id,id] [--dry-run] [--budget 20] [--concurrency 3]
//   node tools/hf.mjs status <request_id>
//
// Credentials (any one form):
//   HF_KEY="id:secret" | HF_CREDENTIALS="id:secret" | HF_API_KEY_ID + HF_API_KEY_SECRET | HF_API_KEY + HF_API_SECRET

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.HF_BASE_URL || 'https://api.higgsfield.ai';
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

// Rough list prices (USD) used only for the pre-flight estimate. Per image, or per second of video.
const PRICE = {
  'marketing-studio/image': { image: 0.04 },
  'higgsfield-ai/soul/standard': { image: 0.1 },
  'higgsfield-ai/soul/v2/standard': { image: 0.01 },
  'xai/grok-imagine-image-2.0': { image: 0.04 },
  'bytedance/seedance-2.0/image-to-video': { second: 0.3 },
  'bytedance/seedance-2.5/image-to-video': { second: 0.33 },
  'kling-video/v3.0/pro/image-to-video': { second: 0.17 },
  'kling-video/o3/first-last-frame': { second: 0.12 },
  'kling-video/v2.5-turbo/pro/image-to-video': { second: 0.1 },
};

function credentials() {
  const e = process.env;
  if (e.HF_KEY) return e.HF_KEY.trim();
  if (e.HF_CREDENTIALS) return e.HF_CREDENTIALS.trim();
  if (e.HF_API_KEY_ID && e.HF_API_KEY_SECRET) return `${e.HF_API_KEY_ID.trim()}:${e.HF_API_KEY_SECRET.trim()}`;
  if (e.HF_API_KEY && e.HF_API_SECRET) return `${e.HF_API_KEY.trim()}:${e.HF_API_SECRET.trim()}`;
  return null;
}

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function api(method, route, body) {
  const key = credentials();
  if (!key) fail('No Higgsfield credentials. Set HF_API_KEY_ID and HF_API_KEY_SECRET (or HF_KEY="id:secret"), then open a new terminal.');
  const url = route.startsWith('http') ? route : `${BASE}/${route.replace(/^\//, '')}`;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'juried-hf/1.0' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (attempt < 4) { await sleep(1500 * attempt); continue; }
      throw new Error(`Network error calling ${url}: ${err.message}`);
    }
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (res.ok) return json;
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(2000 * attempt); continue; }
    const detail = json.detail || json.error || json.message || json.raw || text;
    const hint = res.status === 401 ? ' (check the key id/secret)'
      : res.status === 402 ? ' (API balance is empty: top up the Higgsfield API balance, which is separate from web-app credits)'
      : res.status === 422 ? ' (a parameter was rejected; see detail)' : '';
    throw new Error(`HTTP ${res.status}${hint}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submitAndWait(model, input, { label = model, timeoutMin = 25 } = {}) {
  const started = Date.now();
  const sub = await api('POST', model, input);
  const id = sub.request_id;
  const statusUrl = sub.status_url || `${BASE}/requests/${id}/status`;
  process.stdout.write(`  ↳ ${label}: queued (${id})\n`);
  let delay = 3000;
  let last = '';
  while (true) {
    await sleep(delay);
    delay = Math.min(delay * 1.25, 12000);
    const st = await api('GET', statusUrl);
    if (st.status !== last) { process.stdout.write(`  ↳ ${label}: ${st.status}\n`); last = st.status; }
    if (st.status === 'completed') return { ...st, request_id: id, ms: Date.now() - started };
    if (['failed', 'nsfw', 'canceled'].includes(st.status)) {
      const why = st.status === 'nsfw' ? 'flagged by the safety filter: reword the prompt (describe objects and places, not people)' : (st.error || st.status);
      throw new Error(`${label} ${st.status}: ${why}`);
    }
    if (Date.now() - started > timeoutMin * 60000) throw new Error(`${label} timed out after ${timeoutMin} min (request ${id} may still finish: node tools/hf.mjs status ${id})`);
  }
}

function outputUrl(result, kind) {
  if (kind === 'video') return result.video?.url || result.videos?.[0]?.url;
  if (kind === 'audio') return result.audio?.url || result.audios?.[0]?.url;
  return result.images?.[0]?.url || result.image?.url;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf.length;
}

function extFor(url, kind) {
  const m = url.split('?')[0].match(/\.(png|jpe?g|webp|mp4|mov|webm|mp3|wav)$/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  return kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png';
}

function estimate(asset) {
  const p = PRICE[asset.model] || {};
  if (asset.kind === 'video') return (p.second ?? 0.3) * (asset.input?.duration ?? 5);
  return (p.image ?? 0.05) * (asset.input?.num_images ?? asset.input?.batch_size ?? 1);
}

async function runPlan(planFile) {
  if (!planFile || !fs.existsSync(planFile)) fail(`Plan not found: ${planFile}`);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const root = path.dirname(path.resolve(planFile));
  const outDir = path.resolve(root, '..', plan.outDir || 'juried/raw');
  const manifestFile = path.join(outDir, 'manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  const only = flag('only') ? String(flag('only')).split(',') : null;
  const dry = flag('dry-run', false);
  const budget = Number(flag('budget', plan.budgetUSD ?? 20));
  const conc = Number(flag('concurrency', 3));

  const assets = plan.assets.filter((a) => !only || only.includes(a.id));
  const todo = assets.filter((a) => !(manifest[a.id]?.file && fs.existsSync(path.join(outDir, manifest[a.id].file))));
  const cost = todo.reduce((s, a) => s + estimate(a), 0);
  console.log(`\nHiggsfield plan: ${assets.length} assets, ${todo.length} to generate, est. $${cost.toFixed(2)} (budget $${budget}).`);
  for (const a of todo) console.log(`  • ${a.id.padEnd(22)} ${a.kind.padEnd(6)} ${a.model}  ~$${estimate(a).toFixed(2)}`);
  if (dry) { console.log('\nDry run: nothing submitted.'); return; }
  if (cost > budget) fail(`Estimated $${cost.toFixed(2)} exceeds budget $${budget}. Re-run with --budget ${Math.ceil(cost)} or --only <ids>.`);
  if (!todo.length) { console.log('Everything already generated.'); return; }

  const byId = Object.fromEntries(plan.assets.map((a) => [a.id, a]));
  const pending = new Map(todo.map((a) => [a.id, a]));
  const running = new Set();
  const failed = [];

  const save = () => { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2)); };

  const ready = (a) => Object.values(a.refs || {}).every((rid) => manifest[rid]?.url || (manifest[rid]?.file && !pending.has(rid)));

  async function resolveRefs(a) {
    const input = { ...(a.input || {}) };
    for (const [field, rid] of Object.entries(a.refs || {})) {
      const m = manifest[rid];
      if (!m) throw new Error(`${a.id} needs ${rid}, which has no output`);
      let url = m.url;
      // Remote URLs expire after ~7 days; re-upload the local file when needed.
      if (!url || (m.at && Date.now() - m.at > 6 * 864e5)) url = await upload(path.join(outDir, m.file));
      input[field] = Array.isArray(input[field]) ? [...input[field], url] : url;
    }
    return input;
  }

  async function runOne(a) {
    const attempts = [{ model: a.model, input: a.input }, ...(a.fallbacks || [])];
    let lastErr;
    for (const [i, att] of attempts.entries()) {
      try {
        const base = await resolveRefs({ ...a, input: att.input ?? a.input });
        const input = remap(base, att.map);
        console.log(`\n▶ ${a.id} → ${att.model}${i ? ' (fallback)' : ''}`);
        const res = await submitAndWait(att.model, input, { label: a.id });
        const url = outputUrl(res, a.kind);
        if (!url) throw new Error(`${a.id}: finished but no ${a.kind} URL in response: ${JSON.stringify(res).slice(0, 300)}`);
        const file = `${a.id}.${extFor(url, a.kind)}`;
        const bytes = await download(url, path.join(outDir, file));
        manifest[a.id] = { model: att.model, request_id: res.request_id, url, file, bytes, seconds: Math.round(res.ms / 1000), at: Date.now(), prompt: input.prompt };
        save();
        console.log(`✔ ${a.id} saved (${(bytes / 1e6).toFixed(1)} MB, ${Math.round(res.ms / 1000)}s)`);
        return;
      } catch (err) {
        lastErr = err;
        console.error(`✖ ${a.id} via ${att.model}: ${err.message}`);
      }
    }
    throw lastErr;
  }

  await new Promise((resolve) => {
    const pump = () => {
      if (!pending.size && !running.size) return resolve();
      for (const [id, a] of [...pending]) {
        if (running.size >= conc) break;
        const blocked = Object.values(a.refs || {}).some((rid) => failed.includes(rid));
        if (blocked) { pending.delete(id); failed.push(id); console.error(`✖ ${id} skipped: a referenced asset failed`); continue; }
        if (!ready(a)) continue;
        pending.delete(id);
        running.add(id);
        runOne(a).catch(() => failed.push(id)).finally(() => { running.delete(id); pump(); });
      }
      if (!running.size && pending.size) {
        for (const id of pending.keys()) { failed.push(id); console.error(`✖ ${id} could not start (missing references)`); }
        pending.clear();
        resolve();
      }
    };
    pump();
  });

  console.log(`\nDone. ${Object.keys(manifest).length} assets in ${path.relative(process.cwd(), outDir)}${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
  if (failed.length) process.exitCode = 2;
}

function remap(input, map) {
  if (!map) return input;
  const out = { ...input };
  for (const [from, to] of Object.entries(map)) {
    if (to === null) delete out[from];
    else if (from in out) { out[to] = out[from]; delete out[from]; }
  }
  return out;
}

async function upload(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4' }[ext] || 'application/octet-stream';
  const slot = await api('POST', 'files/generate-upload-url', { content_type: type });
  const res = await fetch(slot.upload_url, { method: 'PUT', headers: slot.upload_headers || { 'Content-Type': type }, body: fs.readFileSync(file) });
  if (!res.ok) throw new Error(`Upload failed ${res.status}`);
  return slot.public_url;
}

(async () => {
  try {
    if (cmd === 'check') {
      const k = credentials();
      if (!k) fail('No credentials found. Set HF_API_KEY_ID and HF_API_KEY_SECRET, then open a new terminal.');
      console.log(`✔ Credentials found (key id ${k.split(':')[0].slice(0, 6)}…).`);
    } else if (cmd === 'smoke') {
      const r = await submitAndWait('higgsfield-ai/soul/v2/standard', { prompt: 'a single drop of molten gold on black stone, macro photograph', resolution: '720p', aspect_ratio: '16:9', batch_size: 1, enhance_prompt: false }, { label: 'smoke' });
      console.log(`✔ Key works. Test image: ${outputUrl(r, 'image')}`);
    } else if (cmd === 'run') {
      await runPlan(argv[1]);
    } else if (cmd === 'status') {
      console.log(JSON.stringify(await api('GET', `requests/${argv[1]}/status`), null, 2));
    } else {
      console.log('Usage: node tools/hf.mjs check | smoke | run <plan.json> [--only a,b] [--dry-run] [--budget 20] | status <id>');
    }
  } catch (err) {
    fail(err.message);
  }
})();
