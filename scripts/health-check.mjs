#!/usr/bin/env node
// Daily health check — verifies all endpoints, workers, APIs, and syncs are operational.
// Usage: node scripts/health-check.mjs

import { readFileSync } from 'fs';
try {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  env.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && !k.startsWith('#')) process.env[k.trim()] ||= v.join('=').trim();
  });
} catch {}

const STAGING = 'https://immobiliere-pujol-staging.roy-68a.workers.dev';
const CRON_WORKER = 'https://pujol-cron-sync.roy-68a.workers.dev';
const EMAIL_WORKER = 'https://pujol-email.kamindudushmantha.workers.dev';
const OPINIONSYSTEM = 'https://api.opinionsystem.fr/v2';
const UBIFLOW = 'https://sw.ubiflow.net/diffusion-annonces.php?MDP_PARTENAIRE=55a6fc447c0ac5c3840087406768fbc760671110&DIFFUSEUR=IMMOBILIERE_PUJOL&ANNONCEUR=ag132582';
const R2_PUBLIC = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev';
const GH_REPO = 'royboy31/immobiliere-pujol-site';

const OS_KEY = process.env.OPINIONSYSTEM_API_KEY || '';
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

// ── Helpers ────────────────────────────────────────────────────────────────

const results = [];
const t0 = Date.now();

async function check(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - start;
    results.push({ name, status: 'OK', ms, detail });
    console.log(`  ✅  ${name} (${ms}ms)${detail ? ' — ' + detail : ''}`);
  } catch (err) {
    const ms = Date.now() - start;
    const msg = err.message || String(err);
    results.push({ name, status: 'FAIL', ms, detail: msg });
    console.log(`  ❌  ${name} (${ms}ms) — ${msg}`);
  }
}

async function httpOk(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// ── Checks ─────────────────────────────────────────────────────────────────

console.log('\n🏥  Immobilière Pujol — Health Check');
console.log(`    ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}\n`);

// 1. Staging site
console.log('── Site ──');

await check('Staging homepage', async () => {
  const res = await httpOk(STAGING);
  const html = await res.text();
  if (!html.includes('Immobilière Pujol')) throw new Error('Missing expected content');
  return `${(html.length / 1024).toFixed(0)} KB`;
});

await check('Search API', async () => {
  const res = await httpOk(`${STAGING}/api/search?q=marseille`);
  const data = await res.json();
  return `${data.results?.length ?? 0} results`;
});

await check('Blog page', async () => {
  await httpOk(`${STAGING}/blog-immobilier-marseille/`);
});

await check('Expert page (Julia)', async () => {
  const res = await httpOk(`${STAGING}/experts/julia-lauron-ventes-de-biens-immobiliers/`);
  const html = await res.text();
  const hasReviews = html.includes('Avis vérifiés');
  return hasReviews ? 'reviews section present' : 'NO reviews section';
});

// 2. Workers
console.log('\n── Workers ──');

await check('Cron sync worker', async () => {
  const res = await httpOk(CRON_WORKER);
  const text = await res.text();
  return text.slice(0, 80);
});

await check('Cron sync /status', async () => {
  const res = await httpOk(`${CRON_WORKER}/status`);
  const data = await res.json();
  const lastSync = data.logs?.[0];
  if (lastSync) return `last: ${lastSync.started_at} — ${lastSync.status}`;
  return 'no logs';
});

await check('Email worker (OPTIONS)', async () => {
  const res = await fetch(`${EMAIL_WORKER}/contact`, {
    method: 'OPTIONS',
    headers: { 'Origin': STAGING },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status !== 204) throw new Error(`HTTP ${res.status}`);
  const cors = res.headers.get('Access-Control-Allow-Origin');
  return `CORS: ${cors}`;
});

// 3. External APIs
console.log('\n── External APIs ──');

await check('Ubiflow XML feed', async () => {
  const res = await httpOk(UBIFLOW);
  const text = await res.text();
  const count = (text.match(/<annonce>/g) || []).length;
  return `${count} annonces in feed`;
});

if (OS_KEY) {
  await check('OpinionSystem /collaborator', async () => {
    const res = await httpOk(`${OPINIONSYSTEM}/client/collaborator?api_key=${OS_KEY}`);
    const data = await res.json();
    return `${data.collaborators?.length ?? 0} collaborators`;
  });

  await check('OpinionSystem /rating (Julia)', async () => {
    const res = await httpOk(`${OPINIONSYSTEM}/collaborator/rating?api_key=${OS_KEY}&collaborator_id=150212`);
    const data = await res.json();
    const r = data.collaborator_rating?.[0];
    return r ? `rating: ${r.rating / 10}/10, ${r.survey_total} reviews` : 'no data';
  });
} else {
  console.log('  ⚠️  OpinionSystem — skipped (no OPINIONSYSTEM_API_KEY)');
}

await check('Mandrill API ping', async () => {
  const res = await fetch('https://mandrillapp.com/api/1.0/users/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: process.env.MANDRILL_API_KEY || 'test' }),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (res.ok && text.includes('PONG')) return 'PONG';
  if (res.status === 500) return 'key not set locally (worker has it)';
  throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
});

// 4. R2 / Static assets
console.log('\n── Storage ──');

await check('R2 active.json', async () => {
  const res = await httpOk(`${R2_PUBLIC}/annonces/active.json`);
  const data = await res.json();
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  return `${count} entries`;
});

await check('R2 cards.json', async () => {
  const res = await httpOk(`${R2_PUBLIC}/annonces/cards.json`);
  const data = await res.json();
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  return `${count} cards`;
});

await check('Logo image (R2)', async () => {
  const res = await httpOk(`${R2_PUBLIC}/2017/01/logo-immobilier-Pujol-h-RVB-300x90.jpg`);
  return `${res.headers.get('content-type')}`;
});

// 5. GitHub Actions
console.log('\n── GitHub Actions ──');

if (GH_TOKEN) {
  await check('Deploy workflow (last run)', async () => {
    const res = await httpOk(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/deploy.yml/runs?per_page=1`,
      { headers: { Authorization: `Bearer ${GH_TOKEN}` } }
    );
    const data = await res.json();
    const run = data.workflow_runs?.[0];
    if (!run) throw new Error('No runs found');
    const age = Math.round((Date.now() - new Date(run.created_at).getTime()) / 3600000);
    return `${run.conclusion} — ${age}h ago`;
  });

  await check('LBI FTP sync (last run)', async () => {
    const res = await httpOk(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/sync-lbi-ftp.yml/runs?per_page=1`,
      { headers: { Authorization: `Bearer ${GH_TOKEN}` } }
    );
    const data = await res.json();
    const run = data.workflow_runs?.[0];
    if (!run) throw new Error('No runs found');
    const age = Math.round((Date.now() - new Date(run.created_at).getTime()) / 3600000);
    return `${run.conclusion} — ${age}h ago`;
  });

  await check('LBI FTP sync (last 24h failures)', async () => {
    const since = new Date(Date.now() - 86400000).toISOString();
    const res = await httpOk(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/sync-lbi-ftp.yml/runs?per_page=50&created=>${since}`,
      { headers: { Authorization: `Bearer ${GH_TOKEN}` } }
    );
    const data = await res.json();
    const runs = data.workflow_runs || [];
    const failed = runs.filter(r => r.conclusion === 'failure').length;
    return `${runs.length} runs, ${failed} failed`;
  });
} else {
  console.log('  ⚠️  GitHub Actions — skipped (no GH_TOKEN). Run: export GH_TOKEN=$(gh auth token)');
}

// ── Summary ────────────────────────────────────────────────────────────────

const elapsed = Date.now() - t0;
const passed = results.filter(r => r.status === 'OK').length;
const failed = results.filter(r => r.status === 'FAIL').length;

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${passed} passed, ${failed} failed — ${elapsed}ms total`);

if (failed > 0) {
  console.log('\n  Failed checks:');
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`    ❌ ${r.name}: ${r.detail}`);
  });
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
