#!/usr/bin/env node
// Build-time: fetch per-expert reviews from the OpinionSystem API and write
// one JSON per matched expert to public/_data/reviews/{slug}.json.
// Read by the expert page at SSR time to show "Avis vérifiés".

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXPERTS_DIR = join(ROOT, 'src/content/experts');
const DEST = join(ROOT, 'public/_data/reviews');

const API_BASE = 'https://api.opinionsystem.fr/v2';
const API_KEY = process.env.OPINIONSYSTEM_API_KEY;

// The 6 standard OpinionSystem criteria labels (transaction immobilier sector).
const CRITERE_LABELS = [
  "Qualité de l'accueil",
  'Qualité du suivi',
  'Respect des engagements',
  'Compétences',
  'Rapport qualité / prix',
  'Recommandation',
];

function normEmail(raw) {
  if (!raw) return '';
  return raw.split('|')[0].trim().replace(/!+$/, '').toLowerCase();
}

async function apiFetch(path) {
  const url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${API_KEY}`;
  const resp = await fetch(url);
  if (resp.status === 204) return null;
  if (!resp.ok) throw new Error(`API ${resp.status} for ${path}`);
  return resp.json();
}

// Simple concurrency limiter
function createPool(concurrency) {
  let active = 0;
  const queue = [];
  function next() {
    if (queue.length === 0 || active >= concurrency) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  }
  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

async function loadExperts() {
  const files = await readdir(EXPERTS_DIR);
  const experts = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(await readFile(join(EXPERTS_DIR, f), 'utf-8'));
      const email = normEmail(d.email);
      if (email && d.slug) experts.push({ slug: d.slug, email, title: d.title });
    } catch {}
  }
  return experts;
}

async function fetchAllSurveys(collaboratorId) {
  const surveys = [];
  let offset = 0;
  const limit = 50;
  while (offset < 500) {
    const data = await apiFetch(`/collaborator/survey?collaborator_id=${collaboratorId}&limit=${limit}&offset=${offset}`);
    // API wraps in { collaborator_survey: [...] }
    const arr = data?.collaborator_survey;
    if (!Array.isArray(arr) || arr.length === 0) break;
    surveys.push(...arr);
    if (arr.length < limit) break;
    offset += limit;
  }
  return surveys;
}

async function main() {
  if (!API_KEY) {
    console.warn('⚠ OPINIONSYSTEM_API_KEY not set — skipping review sync.');
    process.exit(0);
  }

  if (existsSync(DEST)) await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  // 1. Fetch all collaborators, build email → collaborator map
  const resp = await apiFetch('/client/collaborator');
  const collaborators = resp?.client_collaborator;
  if (!Array.isArray(collaborators)) {
    console.warn('⚠ /client/collaborator response unexpected — skipping.');
    process.exit(0);
  }
  const collabByEmail = new Map();
  for (const c of collaborators) {
    const email = (c.email || '').trim().toLowerCase();
    if (email) collabByEmail.set(email, c);
  }
  console.log(`OpinionSystem collaborators: ${collaborators.length}`);

  // 2. Load our experts
  const experts = await loadExperts();
  console.log(`Local experts with email: ${experts.length}`);

  // 3. For each matched expert, fetch rating + surveys
  const pool = createPool(5);
  let matched = 0, totalReviews = 0, skipped = 0, errors = 0;

  const tasks = experts.map((expert) => pool(async () => {
    const collab = collabByEmail.get(expert.email);
    if (!collab) { skipped++; return; }
    matched++;

    try {
      const collaboratorId = collab.collaborator_id;
      const certificateUrl = collab.certificate || null;

      // Fetch rating — API returns { collaborator_rating: [{ ... }] }
      let ratingData = null;
      try {
        const rResp = await apiFetch(`/collaborator/rating?collaborator_id=${collaboratorId}`);
        const rArr = rResp?.collaborator_rating;
        if (Array.isArray(rArr) && rArr.length > 0) ratingData = rArr[0];
      } catch (e) {
        console.warn(`  ⚠ rating fetch failed for ${expert.slug}: ${e.message}`);
      }

      // Fetch surveys
      let rawSurveys = [];
      try {
        rawSurveys = await fetchAllSurveys(collaboratorId);
      } catch (e) {
        console.warn(`  ⚠ survey fetch failed for ${expert.slug}: ${e.message}`);
      }

      // Build rating payload — API scores are 0-100, convert to /10
      const rating = ratingData ? {
        overall: ratingData.rating != null ? +(ratingData.rating / 10).toFixed(1) : null,
        count: ratingData.survey_total ?? rawSurveys.length,
        criteres: CRITERE_LABELS.map((label, i) => {
          const key = `question_${i + 1}`;
          const raw = ratingData[key];
          return { label, score: raw != null ? +(raw / 10).toFixed(1) : 0 };
        }),
      } : null;

      // Build surveys payload
      const surveys = rawSurveys.map((s) => ({
        id: s.survey_id ?? null,
        date: s.answer ? s.answer.split('T')[0] : null,
        clientName: s.name || '',
        property: s.invoice_detail || '',
        comment: s.comment || '',
        agencyResponse: s.comment_response || null,
      }));

      totalReviews += surveys.length;

      const payload = {
        collaboratorId,
        certificateUrl,
        rating,
        surveys,
        fetchedAt: new Date().toISOString(),
      };

      await writeFile(join(DEST, expert.slug + '.json'), JSON.stringify(payload));
    } catch (e) {
      errors++;
      console.warn(`  ✗ ${expert.slug}: ${e.message}`);
    }
  }));

  await Promise.all(tasks);

  console.log(`OpinionSystem sync: ${matched} matched, ${totalReviews} reviews, ${skipped} skipped, ${errors} errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
