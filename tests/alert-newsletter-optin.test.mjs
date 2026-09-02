import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../workers/email/index.ts';

// ── Harness ─────────────────────────────────────────────────────────────────
// Exercises the real fetch handler of the email worker for the internal
// /alerts/newsletter-optin endpoint. External I/O (Brevo, sheet logging) goes
// through a recording fetch stub; D1 through a recording DB stub.

const TOKEN = 'test-internal-token';

function makeDB(calls) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { calls.push({ sql, args }); return {}; },
    all: async () => { calls.push({ sql, args }); return { results: [] }; },
    first: async () => { calls.push({ sql, args }); return null; },
  });
  return { prepare: (sql) => stmt(sql) };
}

function makeEnv(overrides = {}) {
  const dbCalls = [];
  const env = {
    NEWSLETTER_INTERNAL_TOKEN: TOKEN,
    BREVO_API_KEY: 'brevo-key',
    DOI_TEMPLATE_ID: '7',
    NEWSLETTER_LIST_ID: '3',
    NEWSLETTER_CONFIRM_REDIRECT_URL: 'https://example.test/newsletter-confirmee/',
    DB: makeDB(dbCalls),
    ...overrides,
  };
  return { env, dbCalls };
}

function makeCtx() {
  const tasks = [];
  return {
    ctx: { waitUntil: (p) => tasks.push(Promise.resolve(p).catch(() => {})) },
    flush: () => Promise.all(tasks),
  };
}

// Stub global fetch; `doiStatus` drives the doubleOptinConfirmation answer.
function stubFetch(calls, { doiStatus = 201 } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, body: init.body });
    if (u.includes('/contacts/doubleOptinConfirmation')) {
      return new Response(doiStatus < 300 ? '{}' : '{"message":"bad"}', { status: doiStatus });
    }
    return new Response('{}', { status: 200 });
  };
  return () => { globalThis.fetch = original; };
}

function optinRequest({ token = TOKEN, email = 'prospect@example.test' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token !== null) headers['x-internal-token'] = token;
  return new Request('https://pujol-email.test/alerts/newsletter-optin', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email }),
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('newsletter-optin without the internal token is refused (403)', async () => {
  const { env } = makeEnv();
  const { ctx } = makeCtx();
  const fetchCalls = [];
  const restore = stubFetch(fetchCalls);
  try {
    const res = await worker.fetch(optinRequest({ token: null }), env, ctx);
    assert.equal(res.status, 403);
    const res2 = await worker.fetch(optinRequest({ token: 'wrong' }), env, ctx);
    assert.equal(res2.status, 403);
    assert.equal(fetchCalls.length, 0);
  } finally { restore(); }
});

test('success path fires the Brevo DOI with SOURCE=alerte and the alert list', async () => {
  const { env } = makeEnv();
  const { ctx, flush } = makeCtx();
  const fetchCalls = [];
  const restore = stubFetch(fetchCalls);
  try {
    const res = await worker.fetch(optinRequest(), env, ctx);
    await flush();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, doi: true });
    const doi = fetchCalls.find((c) => c.url.includes('/contacts/doubleOptinConfirmation'));
    assert.ok(doi, 'doubleOptinConfirmation must be called');
    const payload = JSON.parse(doi.body);
    assert.equal(payload.email, 'prospect@example.test');
    assert.equal(payload.attributes.SOURCE, 'alerte');
    assert.deepEqual(payload.includeListIds, [3]);
    assert.equal(payload.templateId, 7);
  } finally { restore(); }
});

test('success path records the pending signup for the J+1 reminder', async () => {
  const { env, dbCalls } = makeEnv();
  const { ctx, flush } = makeCtx();
  const restore = stubFetch([]);
  try {
    await worker.fetch(optinRequest(), env, ctx);
    await flush();
    const insert = dbCalls.find((c) => c.sql.includes('INSERT INTO newsletter_reminders'));
    assert.ok(insert, 'pending signup must be recorded');
    assert.equal(insert.args[0], 'prospect@example.test');
  } finally { restore(); }
});

test('Brevo DOI failure returns 502 and writes nothing', async () => {
  const { env, dbCalls } = makeEnv();
  const { ctx, flush } = makeCtx();
  const fetchCalls = [];
  const restore = stubFetch(fetchCalls, { doiStatus: 400 });
  try {
    const res = await worker.fetch(optinRequest(), env, ctx);
    await flush();
    assert.equal(res.status, 502);
    assert.equal((await res.json()).ok, false);
    assert.equal(dbCalls.filter((c) => c.sql.includes('newsletter_reminders')).length, 0);
    // Only the failed DOI call — no signup copy, no sheet write.
    assert.equal(fetchCalls.length, 1);
  } finally { restore(); }
});

test('missing DOI config refuses (501) instead of recording an unconfirmed signup', async () => {
  const { env, dbCalls } = makeEnv({ DOI_TEMPLATE_ID: undefined });
  const { ctx, flush } = makeCtx();
  const fetchCalls = [];
  const restore = stubFetch(fetchCalls);
  try {
    const res = await worker.fetch(optinRequest(), env, ctx);
    await flush();
    assert.equal(res.status, 501);
    assert.equal((await res.json()).ok, false);
    assert.equal(fetchCalls.length, 0, 'no email, no DOI, no sheet');
    assert.equal(dbCalls.length, 0, 'no D1 write');
  } finally { restore(); }
});
