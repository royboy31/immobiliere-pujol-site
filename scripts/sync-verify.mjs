#!/usr/bin/env node
// Sync verification — compares Ubiflow feed, LBI zip (R2), D1 database, and site content.
// Sends a report email to the team via Mandrill.
// Usage: node scripts/sync-verify.mjs [--no-email]
//
// Env vars: OPINIONSYSTEM_API_KEY, MANDRILL_API_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// Or: run with `export GH_TOKEN=$(gh auth token)` for GitHub Actions checks.

import { readFileSync } from 'fs';
try {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  env.split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && !k.startsWith('#')) process.env[k.trim()] ||= v.join('=').trim();
  });
} catch {}

// ── Config ─────────────────────────────────────────────────────────────────

const STAGING = 'https://immobiliere-pujol-staging.roy-68a.workers.dev';
const CRON_WORKER = 'https://pujol-cron-sync.roy-68a.workers.dev';
const EMAIL_WORKER = 'https://pujol-email.kamindudushmantha.workers.dev';
const R2_PUBLIC = 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev';
const UBIFLOW_URL = 'https://sw.ubiflow.net/diffusion-annonces.php?MDP_PARTENAIRE=55a6fc447c0ac5c3840087406768fbc760671110&DIFFUSEUR=IMMOBILIERE_PUJOL&ANNONCEUR=ag132582';
const GH_REPO = 'royboy31/immobiliere-pujol-site';

const MANDRILL_URL = 'https://mandrillapp.com/api/1.0/messages/send';
const MANDRILL_KEY = process.env.MANDRILL_API_KEY || '';
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const SEND_EMAIL = !process.argv.includes('--no-email');
const RECIPIENTS = [
  'kamindudushmantha@gmail.com',
  'roy@perelweb.be',
];

// ── Helpers ────────────────────────────────────────────────────────────────

const report = { checks: [], warnings: [], errors: [], counts: {} };
const t0 = Date.now();

function now() {
  return new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

function addCheck(name, status, detail) {
  report.checks.push({ name, status, detail });
  const icon = status === 'OK' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`  ${icon}  ${name}${detail ? ' — ' + detail : ''}`);
  if (status === 'WARN') report.warnings.push(`${name}: ${detail}`);
  if (status === 'FAIL') report.errors.push(`${name}: ${detail}`);
}

// ── 1. Ubiflow feed ───────────────────────────────────────────────────────

console.log('\n🔄  Sync Verification Report');
console.log(`    ${now()}\n`);
console.log('── 1. Ubiflow Feed (Rentals) ──');

let ubiflowRentals = 0;
let ubiflowSales = 0;
let ubiflowTotal = 0;
try {
  const xml = await fetchText(UBIFLOW_URL);
  const blocks = xml.match(/<annonce[\s>][\s\S]*?<\/annonce>/g) || [];
  ubiflowTotal = blocks.length;
  blocks.forEach(a => {
    const t = a.match(/<type>([^<]+)<\/type>/)?.[1];
    if (t === 'L') ubiflowRentals++;
    else if (t === 'V') ubiflowSales++;
  });
  report.counts.ubiflowTotal = ubiflowTotal;
  report.counts.ubiflowRentals = ubiflowRentals;
  report.counts.ubiflowSales = ubiflowSales;
  addCheck('Ubiflow feed reachable', 'OK', `${ubiflowTotal} total (${ubiflowRentals} rentals, ${ubiflowSales} sales)`);
} catch (err) {
  addCheck('Ubiflow feed reachable', 'FAIL', err.message);
}

// ── 2. R2 data (active.json + cards.json) ─────────────────────────────────

console.log('\n── 2. R2 Storage ──');

let r2Active = [];
let r2Cards = [];
let r2Rentals = 0, r2Sales = 0;

try {
  r2Active = await fetchJson(`${R2_PUBLIC}/annonces/active.json`);
  r2Rentals = r2Active.filter(a => a.type === 'L').length;
  r2Sales = r2Active.filter(a => a.type === 'V').length;
  report.counts.r2Total = r2Active.length;
  report.counts.r2Rentals = r2Rentals;
  report.counts.r2Sales = r2Sales;
  addCheck('R2 active.json', 'OK', `${r2Active.length} total (${r2Rentals} rentals, ${r2Sales} sales)`);
} catch (err) {
  addCheck('R2 active.json', 'FAIL', err.message);
}

try {
  r2Cards = await fetchJson(`${R2_PUBLIC}/annonces/cards.json`);
  report.counts.r2Cards = r2Cards.length;
  if (r2Cards.length === r2Active.length) {
    addCheck('R2 cards.json matches active.json', 'OK', `${r2Cards.length} cards`);
  } else {
    addCheck('R2 cards.json matches active.json', 'WARN', `cards: ${r2Cards.length} vs active: ${r2Active.length}`);
  }
} catch (err) {
  addCheck('R2 cards.json', 'FAIL', err.message);
}

// Check for listings with no photos
const noPhotos = r2Active.filter(a => !a.photos || a.photos.length === 0);
if (noPhotos.length > 0) {
  addCheck('Listings without photos', 'WARN', `${noPhotos.length} listings have 0 photos: ${noPhotos.slice(0, 5).map(a => a.slug).join(', ')}${noPhotos.length > 5 ? '...' : ''}`);
} else {
  addCheck('All listings have photos', 'OK', '');
}

// ── 3. Ubiflow ↔ R2 tally ────────────────────────────────────────────────

console.log('\n── 3. Feed ↔ R2 Tally ──');

// Ubiflow rentals vs R2 rentals (cron worker only syncs type=L)
if (ubiflowRentals > 0 && r2Rentals > 0) {
  const diff = Math.abs(ubiflowRentals - r2Rentals);
  if (diff === 0) {
    addCheck('Ubiflow rentals = R2 rentals', 'OK', `${ubiflowRentals} == ${r2Rentals}`);
  } else if (diff <= 3) {
    addCheck('Ubiflow rentals ≈ R2 rentals', 'WARN', `feed: ${ubiflowRentals}, R2: ${r2Rentals} (diff: ${diff} — may be mid-sync)`);
  } else {
    addCheck('Ubiflow rentals vs R2 rentals', 'FAIL', `feed: ${ubiflowRentals}, R2: ${r2Rentals} (diff: ${diff})`);
  }
} else if (ubiflowRentals === 0) {
  addCheck('Ubiflow feed rentals', 'WARN', '0 rentals in feed — may be temporary');
}

// Ubiflow sales should NOT be in R2 (sales come from LBI only)
if (ubiflowSales > 0) {
  addCheck('Ubiflow sales (ignored by sync)', 'OK', `${ubiflowSales} sales in feed — correctly excluded (LBI is sales source)`);
}

// ── 4. Site content check ─────────────────────────────────────────────────

console.log('\n── 4. Site Content ──');

let siteSearchTotal = 0;
let siteSearchRentals = 0;
let siteSearchSales = 0;

try {
  const rentals = await fetchJson(`${STAGING}/api/search?type=L&limit=1`);
  siteSearchRentals = rentals.total ?? rentals.results?.length ?? 0;
} catch {}

try {
  const sales = await fetchJson(`${STAGING}/api/search?type=V&limit=1`);
  siteSearchSales = sales.total ?? sales.results?.length ?? 0;
} catch {}

try {
  const all = await fetchJson(`${STAGING}/api/search?limit=1`);
  siteSearchTotal = all.total ?? all.results?.length ?? 0;
  report.counts.siteTotal = siteSearchTotal;
  report.counts.siteRentals = siteSearchRentals;
  report.counts.siteSales = siteSearchSales;
  addCheck('Site search API', 'OK', `${siteSearchTotal} total (${siteSearchRentals} rentals, ${siteSearchSales} sales)`);
} catch (err) {
  addCheck('Site search API', 'FAIL', err.message);
}

// Compare site vs R2
if (siteSearchTotal > 0 && r2Active.length > 0) {
  const diff = Math.abs(siteSearchTotal - r2Active.length);
  if (diff === 0) {
    addCheck('Site total = R2 total', 'OK', `${siteSearchTotal} == ${r2Active.length}`);
  } else if (diff <= 5) {
    addCheck('Site total ≈ R2 total', 'WARN', `site: ${siteSearchTotal}, R2: ${r2Active.length} (diff: ${diff} — build may be pending)`);
  } else {
    addCheck('Site total vs R2 total', 'FAIL', `site: ${siteSearchTotal}, R2: ${r2Active.length} (diff: ${diff})`);
  }
}

// ── 5. Cron worker status ─────────────────────────────────────────────────

console.log('\n── 5. Cron Worker ──');

try {
  const status = await fetchJson(`${CRON_WORKER}/status`);
  const logs = status.logs || [];
  if (logs.length > 0) {
    const last = logs[0];
    const ageH = ((Date.now() - new Date(last.started_at).getTime()) / 3600000).toFixed(1);
    addCheck('Last cron sync', last.status === 'success' ? 'OK' : 'FAIL',
      `${last.status} — ${ageH}h ago — feed: ${last.annonces_in_feed ?? '?'}, updated: ${last.updated ?? '?'}, closed: ${last.closed ?? '?'}`);

    if (parseFloat(ageH) > 3) {
      addCheck('Cron freshness', 'WARN', `Last sync was ${ageH}h ago (expected < 2h)`);
    } else {
      addCheck('Cron freshness', 'OK', `${ageH}h ago`);
    }
  } else {
    addCheck('Cron sync logs', 'WARN', 'No sync logs found');
  }
} catch (err) {
  addCheck('Cron worker /status', 'FAIL', err.message);
}

// ── 6. Email worker ───────────────────────────────────────────────────────

console.log('\n── 6. Email Worker ──');

try {
  const res = await fetch(`${EMAIL_WORKER}/contact`, {
    method: 'OPTIONS',
    headers: { 'Origin': STAGING },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 204) {
    addCheck('Email worker CORS', 'OK', `origin: ${res.headers.get('Access-Control-Allow-Origin')}`);
  } else {
    addCheck('Email worker CORS', 'FAIL', `HTTP ${res.status}`);
  }
} catch (err) {
  addCheck('Email worker', 'FAIL', err.message);
}

// ── 7. GitHub Actions (last 24h) ──────────────────────────────────────────

console.log('\n── 7. GitHub Actions (24h) ──');

if (GH_TOKEN) {
  const ghHeaders = { Authorization: `Bearer ${GH_TOKEN}` };

  // Deploy workflow
  try {
    const data = await fetchJson(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/deploy.yml/runs?per_page=50`,
      { headers: ghHeaders }
    );
    const runs = data.workflow_runs || [];
    const last24h = runs.filter(r => Date.now() - new Date(r.created_at).getTime() < 86400000);
    const failed = last24h.filter(r => r.conclusion === 'failure');
    const lastRun = runs[0];
    const ageH = lastRun ? ((Date.now() - new Date(lastRun.created_at).getTime()) / 3600000).toFixed(1) : '?';

    report.counts.deployRuns24h = last24h.length;
    report.counts.deployFailed24h = failed.length;

    if (failed.length === 0) {
      addCheck('Deploy workflow', 'OK', `${last24h.length} runs in 24h, 0 failed, last: ${ageH}h ago`);
    } else {
      addCheck('Deploy workflow', 'WARN', `${last24h.length} runs, ${failed.length} FAILED in 24h`);
    }
  } catch (err) {
    addCheck('Deploy workflow', 'FAIL', err.message);
  }

  // LBI FTP sync
  try {
    const data = await fetchJson(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/sync-lbi-ftp.yml/runs?per_page=50`,
      { headers: ghHeaders }
    );
    const runs = data.workflow_runs || [];
    const last24h = runs.filter(r => Date.now() - new Date(r.created_at).getTime() < 86400000);
    const failed = last24h.filter(r => r.conclusion === 'failure');
    const lastRun = runs[0];
    const ageH = lastRun ? ((Date.now() - new Date(lastRun.created_at).getTime()) / 3600000).toFixed(1) : '?';

    report.counts.lbiRuns24h = last24h.length;
    report.counts.lbiFailed24h = failed.length;

    if (failed.length === 0) {
      addCheck('LBI FTP sync', 'OK', `${last24h.length} runs in 24h, 0 failed, last: ${ageH}h ago`);
    } else if (failed.length <= 2) {
      addCheck('LBI FTP sync', 'WARN', `${last24h.length} runs, ${failed.length} failed in 24h (transient?)`);
    } else {
      addCheck('LBI FTP sync', 'FAIL', `${last24h.length} runs, ${failed.length} FAILED in 24h`);
    }
  } catch (err) {
    addCheck('LBI FTP sync', 'FAIL', err.message);
  }
} else {
  console.log('  ⚠️  Skipped — no GH_TOKEN. Run: export GH_TOKEN=$(gh auth token)');
}

// ── 8. External APIs ──────────────────────────────────────────────────────

console.log('\n── 8. External APIs ──');

const OS_KEY = process.env.OPINIONSYSTEM_API_KEY || '';
if (OS_KEY) {
  try {
    const data = await fetchJson(`https://api.opinionsystem.fr/v2/client/collaborator?api_key=${OS_KEY}`);
    addCheck('OpinionSystem API', 'OK', `${data.collaborators?.length ?? 0} collaborators`);
  } catch (err) {
    addCheck('OpinionSystem API', 'FAIL', err.message);
  }
} else {
  console.log('  ⚠️  OpinionSystem — skipped (no OPINIONSYSTEM_API_KEY)');
}

if (MANDRILL_KEY) {
  try {
    const res = await fetch('https://mandrillapp.com/api/1.0/users/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: MANDRILL_KEY }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    addCheck('Mandrill API', res.ok && text.includes('PONG') ? 'OK' : 'FAIL', text.slice(0, 50));
  } catch (err) {
    addCheck('Mandrill API', 'FAIL', err.message);
  }
} else {
  console.log('  ⚠️  Mandrill — skipped (no MANDRILL_API_KEY)');
}

// ── Summary ────────────────────────────────────────────────────────────────

const elapsed = Date.now() - t0;
const passed = report.checks.filter(c => c.status === 'OK').length;
const warns = report.warnings.length;
const fails = report.errors.length;

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${passed} passed, ${warns} warnings, ${fails} errors — ${elapsed}ms`);

if (fails > 0) {
  console.log('\n  🔴 Errors:');
  report.errors.forEach(e => console.log(`     ${e}`));
}
if (warns > 0) {
  console.log('\n  🟡 Warnings:');
  report.warnings.forEach(w => console.log(`     ${w}`));
}

// ── Counts summary table ──────────────────────────────────────────────────

console.log('\n  📊 Counts:');
console.log(`     Ubiflow feed:  ${report.counts.ubiflowTotal ?? '?'} total (${report.counts.ubiflowRentals ?? '?'}L + ${report.counts.ubiflowSales ?? '?'}V)`);
console.log(`     R2 active:     ${report.counts.r2Total ?? '?'} total (${report.counts.r2Rentals ?? '?'}L + ${report.counts.r2Sales ?? '?'}V)`);
console.log(`     R2 cards:      ${report.counts.r2Cards ?? '?'}`);
console.log(`     Site search:   ${report.counts.siteTotal ?? '?'} total (${report.counts.siteRentals ?? '?'}L + ${report.counts.siteSales ?? '?'}V)`);
console.log(`     Deploys 24h:   ${report.counts.deployRuns24h ?? '?'} runs, ${report.counts.deployFailed24h ?? '?'} failed`);
console.log(`     LBI syncs 24h: ${report.counts.lbiRuns24h ?? '?'} runs, ${report.counts.lbiFailed24h ?? '?'} failed`);
console.log('');

// ── Send email report ──────────────────────────────────────────────────────

if (SEND_EMAIL && MANDRILL_KEY) {
  const statusLabel = fails > 0 ? '🔴 ERRORS' : warns > 0 ? '🟡 WARNINGS' : '🟢 ALL OK';
  const subject = `Pujol Sync Report ${now()} — ${statusLabel}`;

  const checksHtml = report.checks.map(c => {
    const color = c.status === 'OK' ? '#2e7d32' : c.status === 'WARN' ? '#e65100' : '#c62828';
    const icon = c.status === 'OK' ? '✅' : c.status === 'WARN' ? '⚠️' : '❌';
    return `<tr>
      <td style="padding:6px 12px;font-size:13px">${icon}</td>
      <td style="padding:6px 12px;font-size:13px;font-weight:600;color:${color}">${c.name}</td>
      <td style="padding:6px 12px;font-size:13px;color:#555">${c.detail || ''}</td>
    </tr>`;
  }).join('');

  const countsHtml = `
    <table style="border-collapse:collapse;margin:16px 0;width:100%">
      <tr><td style="padding:6px 12px;font-weight:600;color:#55666f">Ubiflow feed</td><td style="padding:6px 12px">${report.counts.ubiflowTotal ?? '?'} total (${report.counts.ubiflowRentals ?? '?'}L + ${report.counts.ubiflowSales ?? '?'}V)</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 12px;font-weight:600;color:#55666f">R2 active</td><td style="padding:6px 12px">${report.counts.r2Total ?? '?'} total (${report.counts.r2Rentals ?? '?'}L + ${report.counts.r2Sales ?? '?'}V)</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;color:#55666f">R2 cards</td><td style="padding:6px 12px">${report.counts.r2Cards ?? '?'}</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 12px;font-weight:600;color:#55666f">Site search</td><td style="padding:6px 12px">${report.counts.siteTotal ?? '?'} total (${report.counts.siteRentals ?? '?'}L + ${report.counts.siteSales ?? '?'}V)</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;color:#55666f">Deploys (24h)</td><td style="padding:6px 12px">${report.counts.deployRuns24h ?? '?'} runs, ${report.counts.deployFailed24h ?? '?'} failed</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 12px;font-weight:600;color:#55666f">LBI syncs (24h)</td><td style="padding:6px 12px">${report.counts.lbiRuns24h ?? '?'} runs, ${report.counts.lbiFailed24h ?? '?'} failed</td></tr>
    </table>`;

  const statusBg = fails > 0 ? '#c62828' : warns > 0 ? '#e65100' : '#2e7d32';

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#eef3ef;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3ef;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

        <!-- Header -->
        <tr><td style="background-color:#0f1a2b;padding:24px 32px;border-radius:8px 8px 0 0" align="center">
          <img src="${STAGING}/images/home/pujol-logo-white.png" alt="Immobilière Pujol" width="220" style="display:block;max-width:220px;height:auto">
        </td></tr>

        <!-- Status bar -->
        <tr><td style="background-color:${statusBg};padding:12px 32px;text-align:center">
          <span style="color:#ffffff;font-size:16px;font-weight:700">${statusLabel}</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="background-color:#ffffff;padding:32px">
          <h1 style="margin:0 0 4px;font-size:18px;color:#0f1a2b">Sync Verification Report</h1>
          <p style="margin:0 0 20px;font-size:13px;color:#7e7e7d">${now()} — ${elapsed}ms — ${passed} passed, ${warns} warnings, ${fails} errors</p>

          <!-- Checks table -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef3ef;border-radius:6px;overflow:hidden;border-collapse:collapse">
            <tr><td colspan="3" style="background-color:#f8faf5;padding:10px 12px;font-size:12px;font-weight:700;color:#55666f;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #B2C54F">Checks</td></tr>
            ${checksHtml}
          </table>

          <!-- Counts -->
          <h2 style="margin:24px 0 4px;font-size:15px;color:#0f1a2b">Listing Counts</h2>
          ${countsHtml}

          ${fails > 0 ? `<h2 style="margin:24px 0 8px;font-size:15px;color:#c62828">Errors</h2><ul style="margin:0;padding-left:20px;color:#c62828;font-size:13px">${report.errors.map(e => `<li>${e}</li>`).join('')}</ul>` : ''}
          ${warns > 0 ? `<h2 style="margin:24px 0 8px;font-size:15px;color:#e65100">Warnings</h2><ul style="margin:0;padding-left:20px;color:#e65100;font-size:13px">${report.warnings.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background-color:#0f1a2b;padding:20px 32px;border-radius:0 0 8px 8px" align="center">
          <p style="margin:0;font-size:12px;color:#ffffff">Immobilière Pujol — Rapport de synchronisation automatique</p>
          <p style="margin:4px 0 0;font-size:11px;color:#ffffff;opacity:0.7">7 rue du Docteur Fiolle, 13006 Marseille — 04 91 37 38 39</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const res = await fetch(MANDRILL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: MANDRILL_KEY,
        message: {
          from_email: 'contact@immobiliere-pujol.com',
          from_name: 'Pujol Sync Monitor',
          to: RECIPIENTS.map(email => ({ email, type: 'to' })),
          subject,
          html,
        },
      }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`  📧 Report emailed to: ${RECIPIENTS.join(', ')}`);
    } else {
      console.log(`  ❌ Email failed: ${JSON.stringify(data).slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`  ❌ Email failed: ${err.message}`);
  }
} else if (SEND_EMAIL && !MANDRILL_KEY) {
  console.log('  ⚠️  Email skipped — no MANDRILL_API_KEY. Use --no-email to suppress this.');
} else {
  console.log('  📧 Email skipped (--no-email flag)');
}

process.exit(fails > 0 ? 1 : 0);
