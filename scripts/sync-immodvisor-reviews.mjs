#!/usr/bin/env node
// Build-time: fetch Immodvisor reviews (one company-wide review/list call) and
// write one JSON per matched expert to public/_data/reviews-immodvisor/{slug}.json,
// plus _company.json for reviews not tied to a specific négociateur (id_pro null).
//
// Coexists with sync-opinionsystem-reviews.mjs: that script owns
// public/_data/reviews/ and wipes it on each run, so Immodvisor uses its OWN
// directory and never collides. Payload shape mirrors OpinionSystem (rating +
// surveys) so the expert page / homepage carousel can merge both sources.
//
// NOTE Immodvisor ratings are on a 0-5 scale (ratingScale: 5); OpinionSystem
// stores overall on /10. Consumers must respect ratingScale when merging.

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXPERTS_DIR = join(ROOT, 'src/content/experts');
const DEST = join(ROOT, 'public/_data/reviews-immodvisor');

const API_BASE = 'https://api.immodvisor.com/';
const API_KEY = process.env.IMMODVISOR_API_KEY;
const CHECKSUM_IN = process.env.IMMODVISOR_CHECKSUM_IN;

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

function normEmail(raw) {
  if (!raw) return '';
  return raw.split('|')[0].trim().replace(/!+$/, '').toLowerCase();
}

// Mirrors the PHP wrapper's calcChecksumIn():
//   sha1(api_key + concat(param values, in order) + checksum_salt_in + format + debug)
function sign(datas, format = 'json') {
  let s = API_KEY;
  for (const v of Object.values(datas)) {
    let val = v;
    if (val === true) val = 1;
    else if (val === false) val = 0;
    else if (val !== null && typeof val === 'object') val = JSON.stringify(val);
    s += val;
  }
  s += CHECKSUM_IN + format + '';
  return sha1(s);
}

async function apiCall(service, datas = {}) {
  const checksum = sign(datas);
  const params = new URLSearchParams({ ...datas, format: 'json', checksum });
  const url = `${API_BASE}${service}?${params}`;
  const resp = await fetch(url, {
    headers: { APIKEY: API_KEY, APIVERSION: '1.7.1' },
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`Immodvisor ${service} HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.status !== 1) throw new Error(`Immodvisor ${service} status ${json.status}: ${json.error || 'unknown'}`);
  return json.datas;
}

async function loadExperts() {
  const files = await readdir(EXPERTS_DIR);
  const byEmail = new Map();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(await readFile(join(EXPERTS_DIR, f), 'utf-8'));
      if (!d.slug) continue;
      const email = normEmail(d.email);
      if (email) byEmail.set(email, d.slug);
      for (const a of (d.emailAliases || [])) {
        const ae = normEmail(a);
        if (ae) byEmail.set(ae, d.slug);
      }
    } catch {}
  }
  return byEmail;
}

// Map one raw Immodvisor review to the survey shape (aligned with OpinionSystem).
function toSurvey(r) {
  return {
    id: r.id ?? null,
    date: r.date ? r.date.split(' ')[0] : null,
    clientName: r.user?.login || '',
    property: r.exp?.name || '',
    rating: r.rating != null ? +r.rating : null, // /5
    title: r.title || '',
    comment: r.description || '',
    agencyResponse: r.answer?.text || null,
    recommended: r.recommended ? 1 : 0,
  };
}

// Aggregate an expert's reviews into a rating block (overall + per-criterion avg, /5).
function buildRating(reviews) {
  if (!reviews.length) return null;
  const overall = +(
    reviews.reduce((s, r) => s + (+r.rating || 0), 0) / reviews.length
  ).toFixed(1);

  const crit = new Map(); // name -> { sum, n }
  for (const r of reviews) {
    for (const c of (r.criterions || [])) {
      if (!c?.name || c.rating == null) continue;
      const e = crit.get(c.name) || { sum: 0, n: 0 };
      e.sum += +c.rating;
      e.n += 1;
      crit.set(c.name, e);
    }
  }
  const criteres = [...crit.entries()].map(([label, { sum, n }]) => ({
    label,
    score: +(sum / n).toFixed(1),
  }));

  return { overall, count: reviews.length, criteres };
}

async function main() {
  if (!API_KEY || !CHECKSUM_IN) {
    console.warn('⚠ IMMODVISOR_API_KEY / IMMODVISOR_CHECKSUM_IN not set — skipping Immodvisor sync.');
    process.exit(0);
  }

  let reviews;
  try {
    const datas = await apiCall('review/list');
    reviews = Array.isArray(datas) ? datas : (datas?.reviews || []);
  } catch (e) {
    console.warn(`⚠ Immodvisor fetch failed — skipping: ${e.message}`);
    process.exit(0);
  }
  if (!reviews.length) {
    console.warn('⚠ Immodvisor returned 0 reviews — skipping.');
    process.exit(0);
  }

  if (existsSync(DEST)) await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  const expertsByEmail = await loadExperts();

  // Group reviews by pro email; null pro email -> company pool.
  const byEmail = new Map();
  const company = [];
  for (const r of reviews) {
    const email = normEmail(r.pro?.email);
    if (!email) { company.push(r); continue; }
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(r);
  }

  let matched = 0, unmatched = 0, totalWritten = 0;
  const fetchedAt = new Date().toISOString();

  for (const [email, group] of byEmail) {
    const slug = expertsByEmail.get(email);
    if (!slug) {
      unmatched++;
      console.log(`  ℹ ${group.length} Immodvisor reviews for ${email} — no matching expert (left in pool below)`);
      // Fold unmatched-pro reviews into the company pool so they aren't lost.
      company.push(...group);
      continue;
    }
    matched++;
    totalWritten += group.length;
    const payload = {
      source: 'immodvisor',
      ratingScale: 5,
      rating: buildRating(group),
      surveys: group.map(toSurvey).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      fetchedAt,
    };
    await writeFile(join(DEST, `${slug}.json`), JSON.stringify(payload));
  }

  // Company-level pool (reviews with no specific négociateur + unmatched pros).
  const companyPayload = {
    source: 'immodvisor',
    ratingScale: 5,
    rating: buildRating(company),
    surveys: company.map(toSurvey).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    fetchedAt,
  };
  await writeFile(join(DEST, '_company.json'), JSON.stringify(companyPayload));

  console.log(
    `Immodvisor sync: ${reviews.length} reviews → ${matched} experts (${totalWritten} reviews), ` +
    `${company.length} in company pool, ${unmatched} unmatched pros.`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
