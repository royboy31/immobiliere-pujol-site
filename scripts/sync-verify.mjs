#!/usr/bin/env node
// Vérification de synchronisation — compare le flux Ubiflow, le zip LBI (R2), la base D1 et le contenu du site.
// Envoie un rapport par email à l'équipe via Mandrill.
// Usage: node scripts/sync-verify.mjs [--target roy|pujol] [--no-email]
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

// ── Target selection ───────────────────────────────────────────────────────

const TARGETS = {
  roy: {
    label: 'Roy',
    staging: 'https://immobiliere-pujol-staging.roy-68a.workers.dev',
    cronWorker: 'https://pujol-cron-sync.roy-68a.workers.dev',
    emailWorker: 'https://pujol-email.roy-68a.workers.dev',
    r2Public: 'https://pub-a37eed540afe4dc9b4479da74ba265e1.r2.dev',
    deployWorkflow: 'deploy.yml',
  },
  pujol: {
    label: 'Pujol',
    // Live production domain (was the *.pujol.workers.dev URL pre-cutover).
    staging: 'https://www.immobiliere-pujol.fr',
    cronWorker: 'https://pujol-cron-sync.pujol.workers.dev',
    emailWorker: 'https://pujol-email.pujol.workers.dev',
    r2Public: 'https://pub-ffb425c962e94d71bef4d2fbce95daee.r2.dev',
    deployWorkflow: 'deploy-pujol.yml',
  },
};

const targetArg = process.argv.find((a, i) => process.argv[i - 1] === '--target') || 'pujol';
if (!TARGETS[targetArg]) {
  console.error(`Unknown target: ${targetArg}. Use --target roy or --target pujol`);
  process.exit(1);
}
const TARGET = TARGETS[targetArg];

// ── Config ─────────────────────────────────────────────────────────────────

const STAGING = TARGET.staging;
const CRON_WORKER = TARGET.cronWorker;
const EMAIL_WORKER = TARGET.emailWorker;
const R2_PUBLIC = TARGET.r2Public;
const DEPLOY_WORKFLOW = TARGET.deployWorkflow;
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
  if (!res.ok) throw new Error(`HTTP ${res.status} depuis ${url}`);
  return res.json();
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status} depuis ${url}`);
  return res.text();
}

function addCheck(name, status, detail) {
  report.checks.push({ name, status, detail });
  const icon = status === 'OK' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`  ${icon}  ${name}${detail ? ' — ' + detail : ''}`);
  if (status === 'WARN') report.warnings.push(`${name}: ${detail}`);
  if (status === 'FAIL') report.errors.push(`${name}: ${detail}`);
}

// ── 1. Flux Ubiflow ──────────────────────────────────────────────────────

console.log(`\n🔄  Rapport de vérification de synchronisation [${TARGET.label}]`);
console.log(`    ${now()}\n`);
console.log('── 1. Flux Ubiflow (Locations) ──');

let ubiflowRentals = 0;
let ubiflowTotal = 0;
try {
  const xml = await fetchText(UBIFLOW_URL);
  const blocks = xml.match(/<annonce[\s>][\s\S]*?<\/annonce>/g) || [];
  ubiflowTotal = blocks.length;
  blocks.forEach(a => {
    const t = a.match(/<type>([^<]+)<\/type>/)?.[1];
    if (t === 'L') ubiflowRentals++;
  });
  report.counts.ubiflowTotal = ubiflowTotal;
  report.counts.ubiflowRentals = ubiflowRentals;
  addCheck('Flux Ubiflow accessible', 'OK', `${ubiflowTotal} annonces dont ${ubiflowRentals} locations`);
} catch (err) {
  addCheck('Flux Ubiflow accessible', 'FAIL', err.message);
}

// ── 2. Stockage R2 (active.json + cards.json) ────────────────────────────

console.log('\n── 2. Stockage R2 ──');

let r2Active = [];
let r2Cards = [];
let r2Rentals = 0, r2Sales = 0;

try {
  r2Active = await fetchJson(`${R2_PUBLIC}/annonces/active.json`);
  r2Rentals = r2Active.filter(a => a.type === 'L').length;
  r2Sales = r2Active.filter(a => a.type === 'V').length;
  const r2UbiflowRentals = r2Active.filter(a => a.type === 'L' && a.source === 'ubiflow').length;
  const r2LbiSales = r2Active.filter(a => a.source === 'lbi').length;
  report.counts.r2Total = r2Active.length;
  report.counts.r2Rentals = r2Rentals;
  report.counts.r2Sales = r2Sales;
  report.counts.r2UbiflowRentals = r2UbiflowRentals;
  report.counts.r2LbiSales = r2LbiSales;
  addCheck('R2 active.json', 'OK', `${r2Active.length} au total (${r2Rentals} locations, ${r2Sales} ventes)`);
  addCheck('R2 locations Ubiflow', 'OK', `${r2UbiflowRentals} locations actives via Ubiflow`);
  addCheck('R2 ventes LBI/FTP', 'OK', `${r2LbiSales} ventes actives via LBI/FTP`);
} catch (err) {
  addCheck('R2 active.json', 'FAIL', err.message);
}

try {
  r2Cards = await fetchJson(`${R2_PUBLIC}/annonces/cards.json`);
  report.counts.r2Cards = r2Cards.length;
  if (r2Cards.length === r2Active.length) {
    addCheck('R2 cards.json correspond à active.json', 'OK', `${r2Cards.length} fiches`);
  } else {
    addCheck('R2 cards.json correspond à active.json', 'WARN', `fiches : ${r2Cards.length} vs actifs : ${r2Active.length}`);
  }
} catch (err) {
  addCheck('R2 cards.json', 'FAIL', err.message);
}

// Vérifier les annonces sans photos
const noPhotos = r2Active.filter(a => !a.photos || a.photos.length === 0);
if (noPhotos.length > 0) {
  addCheck('Annonces sans photos', 'WARN', `${noPhotos.length} annonces ont 0 photo : ${noPhotos.slice(0, 5).map(a => a.slug).join(', ')}${noPhotos.length > 5 ? '...' : ''}`);
} else {
  addCheck('Toutes les annonces ont des photos', 'OK', '');
}

// ── 3. Correspondance Ubiflow ↔ R2 ──────────────────────────────────────

console.log('\n── 3. Flux ↔ R2 ──');

// Locations Ubiflow vs locations R2 (le cron worker ne synchronise que type=L)
if (ubiflowRentals > 0 && r2Rentals > 0) {
  const diff = Math.abs(ubiflowRentals - r2Rentals);
  if (diff === 0) {
    addCheck('Locations Ubiflow = locations R2', 'OK', `${ubiflowRentals} == ${r2Rentals}`);
  } else if (diff <= 3) {
    addCheck('Locations Ubiflow ≈ locations R2', 'WARN', `flux : ${ubiflowRentals}, R2 : ${r2Rentals} (écart : ${diff} — sync en cours ?)`);
  } else {
    addCheck('Locations Ubiflow vs locations R2', 'FAIL', `flux : ${ubiflowRentals}, R2 : ${r2Rentals} (écart : ${diff})`);
  }
} else if (ubiflowRentals === 0) {
  addCheck('Locations dans le flux Ubiflow', 'WARN', '0 location dans le flux — peut-être temporaire');
}

// ── 4. Contenu du site ───────────────────────────────────────────────────

console.log('\n── 4. Contenu du site ──');

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
  addCheck('API recherche du site', 'OK', `${siteSearchTotal} au total (${siteSearchRentals} locations, ${siteSearchSales} ventes)`);
} catch (err) {
  addCheck('API recherche du site', 'FAIL', err.message);
}

// Comparer site vs R2
if (siteSearchTotal > 0 && r2Active.length > 0) {
  const diff = Math.abs(siteSearchTotal - r2Active.length);
  if (diff === 0) {
    addCheck('Total site = total R2', 'OK', `${siteSearchTotal} == ${r2Active.length}`);
  } else if (diff <= 5) {
    addCheck('Total site ≈ total R2', 'WARN', `site : ${siteSearchTotal}, R2 : ${r2Active.length} (écart : ${diff} — build en attente ?)`);
  } else {
    addCheck('Total site vs total R2', 'FAIL', `site : ${siteSearchTotal}, R2 : ${r2Active.length} (écart : ${diff})`);
  }
}

// ── 5. État du worker cron ───────────────────────────────────────────────

console.log('\n── 5. Worker Cron ──');

try {
  const status = await fetchJson(`${CRON_WORKER}/status`);
  const logs = Array.isArray(status) ? status : (status.logs || []);
  if (logs.length > 0) {
    const last = logs[0];
    const syncDate = last.sync_date || last.started_at;
    const ageH = syncDate ? ((Date.now() - new Date(syncDate + 'Z').getTime()) / 3600000).toFixed(1) : '?';
    const isOk = (last.errors ?? 0) === 0;
    addCheck('Dernière sync cron', isOk ? 'OK' : 'FAIL',
      `${isOk ? 'succès' : 'erreurs'} — il y a ${ageH}h — flux : ${last.annonces_in_feed ?? '?'}, mises à jour : ${last.updated ?? '?'}, fermées : ${last.closed ?? '?'}`);

    if (ageH !== '?' && parseFloat(ageH) > 3) {
      addCheck('Fraîcheur du cron', 'WARN', `Dernière sync il y a ${ageH}h (attendu < 2h)`);
    } else {
      addCheck('Fraîcheur du cron', 'OK', `il y a ${ageH}h`);
    }
  } else {
    addCheck('Logs de sync cron', 'WARN', 'Aucun log de sync trouvé');
  }
} catch (err) {
  addCheck('Worker cron /status', 'FAIL', err.message);
}

// ── 6. Inventaire D1 (actifs vs fermés par source) ──────────────────────

console.log('\n── 6. Inventaire D1 ──');

let d1UbiflowActive = 0, d1UbiflowClosed = 0;
let d1LbiActive = 0, d1LbiClosed = 0;

try {
  const rows = await fetchJson(`${CRON_WORKER}/counts`);
  for (const r of rows) {
    if (r.source === 'ubiflow' && r.status === 'active') d1UbiflowActive = r.count;
    if (r.source === 'ubiflow' && r.status === 'closed') d1UbiflowClosed = r.count;
    if (r.source === 'lbi' && r.status === 'active') d1LbiActive = r.count;
    if (r.source === 'lbi' && r.status === 'closed') d1LbiClosed = r.count;
  }
  const totalActive = d1UbiflowActive + d1LbiActive;
  const totalClosed = d1UbiflowClosed + d1LbiClosed;

  report.counts.d1UbiflowActive = d1UbiflowActive;
  report.counts.d1UbiflowClosed = d1UbiflowClosed;
  report.counts.d1LbiActive = d1LbiActive;
  report.counts.d1LbiClosed = d1LbiClosed;
  report.counts.d1TotalActive = totalActive;
  report.counts.d1TotalClosed = totalClosed;

  addCheck('D1 Ubiflow (locations)', 'OK', `${d1UbiflowActive} actives, ${d1UbiflowClosed} fermées`);
  addCheck('D1 LBI/FTP (ventes)', 'OK', `${d1LbiActive} actives, ${d1LbiClosed} fermées`);
  addCheck('D1 Total général', 'OK', `${totalActive} annonces actives (${d1UbiflowActive} locations + ${d1LbiActive} ventes), ${totalClosed} fermées`);
} catch (err) {
  addCheck('Compteurs inventaire D1', 'FAIL', err.message);
}

// ── 7. Worker email ──────────────────────────────────────────────────────

console.log('\n── 7. Worker Email ──');

try {
  const res = await fetch(`${EMAIL_WORKER}/contact`, {
    method: 'OPTIONS',
    headers: { 'Origin': STAGING },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 204) {
    addCheck('CORS worker email', 'OK', `origin : ${res.headers.get('Access-Control-Allow-Origin')}`);
  } else {
    addCheck('CORS worker email', 'FAIL', `HTTP ${res.status}`);
  }
} catch (err) {
  addCheck('Worker email', 'FAIL', err.message);
}

// ── 8. GitHub Actions (dernières 24h) ────────────────────────────────────

console.log('\n── 8. GitHub Actions (24h) ──');

if (GH_TOKEN) {
  const ghHeaders = { Authorization: `Bearer ${GH_TOKEN}` };

  // Workflow de déploiement
  try {
    const data = await fetchJson(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/${DEPLOY_WORKFLOW}/runs?per_page=50`,
      { headers: ghHeaders }
    );
    const runs = data.workflow_runs || [];
    const last24h = runs.filter(r => Date.now() - new Date(r.created_at).getTime() < 86400000);
    const failed = last24h.filter(r => r.conclusion === 'failure');
    // Status reflects the LATEST completed deploy, not a 24h failure tally: what
    // matters is whether the site is currently deployable. Past transient
    // failures that a later run fixed shouldn't warn for a whole day.
    const lastDone = runs.find(r => r.status === 'completed');
    const lastRun = runs[0];
    const ageH = lastRun ? ((Date.now() - new Date(lastRun.created_at).getTime()) / 3600000).toFixed(1) : '?';

    report.counts.deployRuns24h = last24h.length;
    report.counts.deployFailed24h = failed.length;

    const failNote = failed.length ? ` (${failed.length} échec(s) plus tôt sur 24h, résolus)` : '';
    if (!lastDone || lastDone.conclusion === 'success') {
      addCheck('Workflow déploiement', 'OK', `dernier déploiement OK il y a ${ageH}h${failNote}`);
    } else {
      addCheck('Workflow déploiement', 'WARN', `dernier déploiement EN ÉCHEC il y a ${ageH}h`);
    }
  } catch (err) {
    addCheck('Workflow déploiement', 'FAIL', err.message);
  }

  // Sync LBI FTP
  try {
    const data = await fetchJson(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/sync-lbi-ftp.yml/runs?per_page=50`,
      { headers: ghHeaders }
    );
    const runs = data.workflow_runs || [];
    const recent = runs.slice(0, 3);
    const failed = recent.filter(r => r.conclusion === 'failure');
    const lastRun = runs[0];
    const ageH = lastRun ? ((Date.now() - new Date(lastRun.created_at).getTime()) / 3600000).toFixed(1) : '?';

    // What matters is data freshness, not individual run failures: the FTP pull
    // from Infomaniak occasionally times out (curl exit 28) from CI, but the
    // next success refreshes R2 and the zip content rarely changes. So a single
    // transient timeout with a recent success stays GREEN; we only WARN once the
    // sync is several hours behind, and FAIL when the zip is genuinely stale.
    const FRESH_OK_H = 4;   // a success within this window → all good
    const FRESH_FAIL_H = 8; // no success this long → stale, real problem
    const lastSuccess = runs.find(r => r.conclusion === 'success');
    const successAgeH = lastSuccess
      ? (Date.now() - new Date(lastSuccess.created_at).getTime()) / 3600000
      : Infinity;
    const sinceTxt = successAgeH === Infinity ? '∞' : successAgeH.toFixed(1);

    report.counts.lbiRuns24h = recent.length;
    report.counts.lbiFailed24h = failed.length;

    if (successAgeH > FRESH_FAIL_H) {
      addCheck('Sync LBI FTP', 'FAIL', `aucun succès depuis ${sinceTxt}h — zip LBI périmé`);
    } else if (successAgeH > FRESH_OK_H) {
      addCheck('Sync LBI FTP', 'WARN', `sync FTP en retard — dernier succès il y a ${sinceTxt}h`);
    } else {
      const note = failed.length ? ` (${failed.length} timeout récent sans impact)` : '';
      addCheck('Sync LBI FTP', 'OK', `dernier succès il y a ${sinceTxt}h${note}`);
    }
  } catch (err) {
    addCheck('Sync LBI FTP', 'FAIL', err.message);
  }
} else {
  console.log('  ⚠️  Ignoré — pas de GH_TOKEN. Exécuter : export GH_TOKEN=$(gh auth token)');
}

// ── 9. APIs externes ─────────────────────────────────────────────────────

console.log('\n── 9. APIs externes ──');

const OS_KEY = process.env.OPINIONSYSTEM_API_KEY || '';
if (OS_KEY) {
  try {
    const data = await fetchJson(`https://api.opinionsystem.fr/v2/client/collaborator?api_key=${OS_KEY}`);
    addCheck('API OpinionSystem', 'OK', `${data.collaborators?.length ?? 0} collaborateurs`);
  } catch (err) {
    addCheck('API OpinionSystem', 'FAIL', err.message);
  }
} else {
  console.log('  ⚠️  OpinionSystem — ignoré (pas de OPINIONSYSTEM_API_KEY)');
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
    addCheck('API Mandrill', res.ok && text.includes('PONG') ? 'OK' : 'FAIL', text.slice(0, 50));
  } catch (err) {
    addCheck('API Mandrill', 'FAIL', err.message);
  }
} else {
  console.log('  ⚠️  Mandrill — ignoré (pas de MANDRILL_API_KEY)');
}

// ── Résumé ────────────────────────────────────────────────────────────────

const elapsed = Date.now() - t0;
const passed = report.checks.filter(c => c.status === 'OK').length;
const warns = report.warnings.length;
const fails = report.errors.length;

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${passed} réussis, ${warns} avertissements, ${fails} erreurs — ${elapsed}ms`);

if (fails > 0) {
  console.log('\n  🔴 Erreurs :');
  report.errors.forEach(e => console.log(`     ${e}`));
}
if (warns > 0) {
  console.log('\n  🟡 Avertissements :');
  report.warnings.forEach(w => console.log(`     ${w}`));
}

// ── Tableau récapitulatif des compteurs ──────────────────────────────────

console.log('\n  📊 Compteurs :');
console.log(`     Flux Ubiflow :   ${report.counts.ubiflowTotal ?? '?'} total (${report.counts.ubiflowRentals ?? '?'} locations)`);
console.log(`     R2 actifs :      ${report.counts.r2Total ?? '?'} total (${report.counts.r2Rentals ?? '?'} loc. + ${report.counts.r2Sales ?? '?'} ventes)`);
console.log(`       ↳ Ubiflow :    ${report.counts.r2UbiflowRentals ?? '?'} locations`);
console.log(`       ↳ LBI/FTP :    ${report.counts.r2LbiSales ?? '?'} ventes`);
console.log(`     R2 fiches :      ${report.counts.r2Cards ?? '?'}`);
console.log(`     D1 Ubiflow :     ${report.counts.d1UbiflowActive ?? '?'} actives, ${report.counts.d1UbiflowClosed ?? '?'} fermées`);
console.log(`     D1 LBI/FTP :     ${report.counts.d1LbiActive ?? '?'} actives, ${report.counts.d1LbiClosed ?? '?'} fermées`);
console.log(`     D1 Total :       ${report.counts.d1TotalActive ?? '?'} actives, ${report.counts.d1TotalClosed ?? '?'} fermées`);
console.log(`     Recherche site : ${report.counts.siteTotal ?? '?'} total (${report.counts.siteRentals ?? '?'} loc. + ${report.counts.siteSales ?? '?'} ventes)`);
console.log(`     Déploiements 24h : ${report.counts.deployRuns24h ?? '?'} exéc., ${report.counts.deployFailed24h ?? '?'} échecs`);
console.log(`     Syncs LBI 24h :   ${report.counts.lbiRuns24h ?? '?'} exéc., ${report.counts.lbiFailed24h ?? '?'} échecs`);
console.log('');

// ── Envoi du rapport par email ────────────────────────────────────────────

if (SEND_EMAIL && MANDRILL_KEY) {
  const statusLabel = fails > 0 ? '🔴 ERREURS' : warns > 0 ? '🟡 AVERTISSEMENTS' : '🟢 TOUT OK';
  const subject = `Rapport Sync Pujol [${TARGET.label}] ${now()} — ${statusLabel}`;

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
      <tr><td colspan="2" style="padding:8px 12px;font-weight:700;color:#0f1a2b;font-size:13px;border-bottom:2px solid #B2C54F;text-transform:uppercase;letter-spacing:0.5px">Annonces actives</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;color:#55666f">Ubiflow (locations)</td><td style="padding:6px 12px">${report.counts.d1UbiflowActive ?? '?'} actives</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 12px;font-weight:600;color:#55666f">LBI/FTP (ventes)</td><td style="padding:6px 12px">${report.counts.d1LbiActive ?? '?'} actives</td></tr>
      <tr><td style="padding:6px 12px;font-weight:700;color:#0f1a2b">TOTAL ACTIF</td><td style="padding:6px 12px;font-weight:700;color:#0f1a2b">${report.counts.d1TotalActive ?? '?'} annonces</td></tr>

      <tr><td colspan="2" style="padding:8px 12px;font-weight:700;color:#0f1a2b;font-size:13px;border-bottom:2px solid #e65100;text-transform:uppercase;letter-spacing:0.5px;padding-top:16px">Annonces fermées</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 12px;font-weight:600;color:#55666f">Ubiflow fermées</td><td style="padding:6px 12px">${report.counts.d1UbiflowClosed ?? '?'}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;color:#55666f">LBI/FTP fermées</td><td style="padding:6px 12px">${report.counts.d1LbiClosed ?? '?'}</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 12px;font-weight:700;color:#0f1a2b">TOTAL FERMÉES</td><td style="padding:6px 12px;font-weight:700;color:#0f1a2b">${report.counts.d1TotalClosed ?? '?'}</td></tr>

      <tr><td colspan="2" style="padding:8px 12px;font-weight:700;color:#0f1a2b;font-size:13px;border-bottom:2px solid #55666f;text-transform:uppercase;letter-spacing:0.5px;padding-top:16px">Pipeline de données</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;color:#55666f">Flux Ubiflow</td><td style="padding:6px 12px">${report.counts.ubiflowTotal ?? '?'} total (${report.counts.ubiflowRentals ?? '?'} locations)</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 12px;font-weight:600;color:#55666f">R2 actifs</td><td style="padding:6px 12px">${report.counts.r2Total ?? '?'} (${report.counts.r2UbiflowRentals ?? '?'} Ubiflow + ${report.counts.r2LbiSales ?? '?'} LBI)</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;color:#55666f">R2 fiches</td><td style="padding:6px 12px">${report.counts.r2Cards ?? '?'}</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 12px;font-weight:600;color:#55666f">Recherche site</td><td style="padding:6px 12px">${report.counts.siteTotal ?? '?'} total (${report.counts.siteRentals ?? '?'} loc. + ${report.counts.siteSales ?? '?'} ventes)</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;color:#55666f">Déploiements (24h)</td><td style="padding:6px 12px">${report.counts.deployRuns24h ?? '?'} exéc., ${report.counts.deployFailed24h ?? '?'} échecs</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 12px;font-weight:600;color:#55666f">Syncs LBI (24h)</td><td style="padding:6px 12px">${report.counts.lbiRuns24h ?? '?'} exéc., ${report.counts.lbiFailed24h ?? '?'} échecs</td></tr>
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

        <!-- En-tête -->
        <tr><td style="background-color:#0f1a2b;padding:24px 32px;border-radius:8px 8px 0 0" align="center">
          <img src="${STAGING}/images/home/pujol-logo-white.png" alt="Immobilière Pujol" width="220" style="display:block;max-width:220px;height:auto">
        </td></tr>

        <!-- Barre de statut -->
        <tr><td style="background-color:${statusBg};padding:12px 32px;text-align:center">
          <span style="color:#ffffff;font-size:16px;font-weight:700">${statusLabel}</span>
        </td></tr>

        <!-- Corps -->
        <tr><td style="background-color:#ffffff;padding:32px">
          <h1 style="margin:0 0 4px;font-size:18px;color:#0f1a2b">Rapport de vérification de synchronisation</h1>
          <p style="margin:0 0 20px;font-size:13px;color:#7e7e7d">${now()} — ${elapsed}ms — ${passed} réussis, ${warns} avertissements, ${fails} erreurs</p>

          <!-- Tableau des vérifications -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef3ef;border-radius:6px;overflow:hidden;border-collapse:collapse">
            <tr><td colspan="3" style="background-color:#f8faf5;padding:10px 12px;font-size:12px;font-weight:700;color:#55666f;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #B2C54F">Vérifications</td></tr>
            ${checksHtml}
          </table>

          <!-- Compteurs -->
          <h2 style="margin:24px 0 4px;font-size:15px;color:#0f1a2b">Compteurs d'annonces</h2>
          ${countsHtml}

          ${fails > 0 ? `<h2 style="margin:24px 0 8px;font-size:15px;color:#c62828">Erreurs</h2><ul style="margin:0;padding-left:20px;color:#c62828;font-size:13px">${report.errors.map(e => `<li>${e}</li>`).join('')}</ul>` : ''}
          ${warns > 0 ? `<h2 style="margin:24px 0 8px;font-size:15px;color:#e65100">Avertissements</h2><ul style="margin:0;padding-left:20px;color:#e65100;font-size:13px">${report.warnings.map(w => `<li>${w}</li>`).join('')}</ul>` : ''}
        </td></tr>

        <!-- Pied de page -->
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
          from_name: 'Pujol — Surveillance Sync',
          to: RECIPIENTS.map(email => ({ email, type: 'to' })),
          subject,
          html,
        },
      }),
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`  📧 Rapport envoyé à : ${RECIPIENTS.join(', ')}`);
    } else {
      console.log(`  ❌ Échec envoi : ${JSON.stringify(data).slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`  ❌ Échec envoi : ${err.message}`);
  }
} else if (SEND_EMAIL && !MANDRILL_KEY) {
  console.log('  ⚠️  Email ignoré — pas de MANDRILL_API_KEY. Utiliser --no-email pour supprimer cet avertissement.');
} else {
  console.log('  📧 Email ignoré (option --no-email)');
}

process.exit(fails > 0 ? 1 : 0);
