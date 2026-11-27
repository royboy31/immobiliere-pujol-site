import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import worker, { gaelleSignatureHtml } from './index.ts';

function createReminderDb(seed = []) {
  const rows = new Map(seed.map((row) => [row.email.toLowerCase(), {
    email: row.email.toLowerCase(),
    signup_at: row.signup_at,
    reminder_at: row.reminder_at ?? null,
  }]));
  return {
    rows,
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) {
          if (values.length > 100) throw new Error('D1_ERROR: too many SQL variables');
          args = values;
          return statement;
        },
        async run() {
          if (sql.includes('VALUES (?, ?, NULL)')) {
            const [email, signupAt] = args;
            const current = rows.get(email);
            if (!current) rows.set(email, { email, signup_at: signupAt, reminder_at: null });
            else if (signupAt < current.signup_at) current.signup_at = signupAt;
          } else if (sql.includes('VALUES (?, ?, ?)')) {
            const [email, signupAt, reminderAt] = args;
            const current = rows.get(email);
            if (!current) rows.set(email, { email, signup_at: signupAt, reminder_at: reminderAt });
            else if (!current.reminder_at) current.reminder_at = reminderAt;
          }
          return { success: true };
        },
        async all() {
          if (sql.includes('WHERE email IN')) {
            return { results: args.map((email) => rows.get(email)).filter(Boolean) };
          }
          if (sql.includes('reminder_at IS NULL')) {
            const [start, cutoff] = args;
            return { results: [...rows.values()]
              .filter((row) => !row.reminder_at && row.signup_at >= start && row.signup_at <= cutoff)
              .sort((a, b) => a.signup_at.localeCompare(b.signup_at))
              .slice(0, sql.includes('LIMIT 50') ? 50 : undefined) };
          }
          throw new Error(`unexpected D1 query: ${sql}`);
        },
      };
      return statement;
    },
  };
}

const productionEnv = {
  ALLOWED_ORIGIN: 'https://www.immobiliere-pujol.fr',
  BREVO_API_KEY: 'test-key',
  NEWSLETTER_LIST_ID: '3',
  DOI_TEMPLATE_ID: '42',
};

test('scheduled reconciliation is inert outside production', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('fetch must not run');
  };

  try {
    await worker.scheduled({}, { ...productionEnv, ALLOWED_ORIGIN: 'https://staging.example' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled reconciliation updates confirmed site contacts without exposing PII in URLs', async () => {
  const originalFetch = globalThis.fetch;
  const sheetWrites = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('/v3/contacts?')) {
      assert.match(url, /listIds=3/);
      return Response.json({
        contacts: [
          { email: 'confirmed@example.com', listIds: [3], attributes: { SOURCE: 'site' } },
          { email: 'no-click@example.com', listIds: [3], attributes: { SOURCE: 'SITE' } },
          { email: 'imported@example.com', listIds: [3], attributes: {} },
        ],
      });
    }
    if (url.includes('/v3/smtp/statistics/events?')) {
      assert.match(url, /event=clicks/);
      assert.match(url, /templateId=42/);
      return Response.json({
        events: [
          { email: 'confirmed@example.com', date: '2026-11-01T09:00:00+01:00' },
          { email: 'confirmed@example.com', date: '2026-11-01T09:30:00+02:00' },
        ],
      });
    }

    assert.equal(url.includes('@'), false);
    sheetWrites.push(JSON.parse(init.body));
    return Response.json({ ok: true, mode: 'update' });
  };

  try {
    await worker.scheduled({}, productionEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sheetWrites.length, 1);
  assert.deepEqual(sheetWrites[0], {
    tab: 'Newsletter',
    key: 'Email',
    records: [
      {
        Email: 'confirmed@example.com',
        'Statut opt-in': 'Confirmé (double opt-in)',
        'Date confirmation': '01/11/2026 08:30:00',
      },
      {
        Email: 'no-click@example.com',
        'Statut opt-in': 'Confirmé (double opt-in)',
      },
      {
        Email: 'imported@example.com',
        'Statut opt-in': 'Confirmé (double opt-in)',
      },
    ],
    updateOnly: true,
    writeOnce: ['Date confirmation'],
  });
});

test('Apps Script batch mode updates every duplicate and never inserts missing contacts', () => {
  const rows = [
    ['Date', 'Email', 'Statut opt-in', 'Date confirmation'],
    ['01/08/2026', 'same@example.com', 'En attente (double opt-in)', ''],
    ['02/08/2026', 'same@example.com', 'En attente (double opt-in)', '02/08/2026 12:00:00'],
    ['03/08/2026', 'other@example.com', 'En attente (double opt-in)', ''],
  ];
  const sheet = {
    getLastColumn: () => rows[0].length,
    getLastRow: () => rows.length,
    appendRow: (row) => rows.push(row),
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValue: () => rows[row - 1][column - 1],
        setValue: (value) => { rows[row - 1][column - 1] = value; },
        getValues: () => Array.from({ length: rowCount }, (_, rowOffset) =>
          Array.from({ length: columnCount }, (_, columnOffset) =>
            rows[row - 1 + rowOffset][column - 1 + columnOffset]
          )
        ),
        setValues: (values) => {
          values.forEach((valuesRow, rowOffset) => {
            valuesRow.forEach((value, columnOffset) => {
              rows[row - 1 + rowOffset][column - 1 + columnOffset] = value;
            });
          });
        },
      };
    },
  };
  const context = {
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (content) => ({
        setMimeType() { return this; },
        getContent() { return content; },
      }),
    },
  };
  vm.runInNewContext(fs.readFileSync(new URL('./sheets-apps-script.gs', import.meta.url), 'utf8'), context);

  const response = context.doPost({ postData: { contents: JSON.stringify({
    tab: 'Newsletter',
    key: 'Email',
    records: [
      {
        Email: 'same@example.com',
        'Statut opt-in': 'Confirmé (double opt-in)',
        'Date confirmation': '17/08/2026 11:30:00',
      },
      {
        Email: 'missing@example.com',
        'Statut opt-in': 'Confirmé (double opt-in)',
      },
    ],
    updateOnly: true,
    writeOnce: ['Date confirmation'],
  }) } });

  assert.deepEqual(JSON.parse(response.getContent()), {
    ok: true,
    mode: 'batch-update',
    matchedRecords: 1,
    updatedRows: 2,
  });
  assert.equal(rows.length, 4);
  assert.equal(rows[1][2], 'Confirmé (double opt-in)');
  assert.equal(rows[1][3], '17/08/2026 11:30:00');
  assert.equal(rows[2][2], 'Confirmé (double opt-in)');
  assert.equal(rows[2][3], '02/08/2026 12:00:00');
  assert.equal(rows[3][2], 'En attente (double opt-in)');

});

test('successful DOI signup records future reminder state in D1', async () => {
  const originalFetch = globalThis.fetch;
  const db = createReminderDb();
  const pending = [];
  const mailCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('doubleOptinConfirmation')) return new Response('', { status: 201 });
    if (url.includes('script.google.com')) return Response.json({ ok: true, mode: 'insert' });
    if (url.includes('mandrillapp.com') || url.includes('/v3/smtp/email')) {
      mailCalls.push(url);
      return Response.json([{ status: 'sent' }]);
    }
    throw new Error(`unexpected fetch ${url} ${init.method || 'GET'}`);
  };

  try {
    const body = new FormData();
    body.set('email', 'Future@Example.com');
    const response = await worker.fetch(new Request('https://worker.example/newsletter', {
      method: 'POST',
      headers: { Origin: 'https://www.immobiliere-pujol.fr' },
      body,
    }), {
      ...productionEnv,
      DB: db,
      NEWSLETTER_CONFIRM_REDIRECT_URL: 'https://www.immobiliere-pujol.fr/merci/',
      MANDRILL_API_KEY: 'mandrill-key',
    }, { waitUntil(promise) { pending.push(promise); } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, doi: true });
    await Promise.all(pending);
    assert.equal(db.rows.get('future@example.com')?.reminder_at, null);
    assert.match(db.rows.get('future@example.com')?.signup_at || '', /^\d{4}-\d{2}-\d{2}T/);
    // Caroline asked on 17/09/2026 to stop the internal signup notification.
    assert.equal(mailCalls.length, 0, 'no notification email to contact@ or Caroline');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('one-time DOI reminder dry run excludes confirmed and already-reminded contacts', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/v3/contacts?')) return Response.json({
      contacts: [{ email: 'confirmed@example.com', listIds: [3] }],
    });
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/newsletter/reminders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': 'newsletter-token' },
      body: JSON.stringify({
        dryRun: true,
        emails: ['eligible@example.com', 'confirmed@example.com', 'reminded@example.com', 'missing@example.com'],
      }),
    }), {
      ...productionEnv,
      NEWSLETTER_INTERNAL_TOKEN: 'newsletter-token',
      DB: createReminderDb([
        { email: 'eligible@example.com', signup_at: '2026-07-22T09:00:00.000Z' },
        { email: 'confirmed@example.com', signup_at: '2026-07-23T09:00:00.000Z' },
        { email: 'reminded@example.com', signup_at: '2026-07-24T09:00:00.000Z', reminder_at: '2026-07-25T09:00:00.000Z' },
      ]),
    }, {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      dryRun: true,
      requested: 4,
      eligible: 2,
      excludedConfirmed: 1,
      excludedNotPending: 0,
      excludedAlreadyReminded: 1,
    });
    assert.equal(calls.some((url) => url.includes('doubleOptinConfirmation')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('one-time DOI reminder marks the Sheet only after Brevo accepts it', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url.includes('/v3/contacts?')) return Response.json({ contacts: [] });
    if (url.includes('doubleOptinConfirmation')) return new Response('', { status: 201 });
    if (url.includes('script.google.com') && body?.data) return Response.json({ ok: true, mode: 'update' });
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/newsletter/reminders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': 'newsletter-token' },
      body: JSON.stringify({ dryRun: false, emails: ['eligible@example.com'] }),
    }), {
      ...productionEnv,
      NEWSLETTER_INTERNAL_TOKEN: 'newsletter-token',
      DB: createReminderDb([
        { email: 'eligible@example.com', signup_at: '2026-07-22T09:00:00.000Z' },
      ]),
    }, {});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sent, 1);
    const doiIndex = calls.findIndex((call) => call.url.includes('doubleOptinConfirmation'));
    const markIndex = calls.findIndex((call) => call.body?.data?.['Date rappel opt-in']);
    assert.ok(doiIndex >= 0 && markIndex > doiIndex);
    assert.equal(calls[doiIndex].body.attributes, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('automatic reminders send once for eligible post-release signups', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const now = Date.now();
  const signupAt = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  const autoFrom = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url.includes('/v3/contacts?')) return Response.json({ contacts: [] });
    if (url.includes('/v3/smtp/statistics/events?')) return Response.json({ events: [] });
    if (url.includes('script.google.com') && Array.isArray(body?.records)) {
      return Response.json({ ok: true, matchedRecords: 0, updatedRows: 0 });
    }
    if (url.includes('doubleOptinConfirmation')) return new Response('', { status: 201 });
    if (url.includes('script.google.com') && body?.data) return Response.json({ ok: true, mode: 'update' });
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const env = {
      ...productionEnv,
      DB: createReminderDb([{ email: 'future@example.com', signup_at: signupAt }]),
      NEWSLETTER_REMINDER_AUTO_FROM: autoFrom,
    };
    await worker.scheduled({ cron: '20 * * * *' }, env);
    await worker.scheduled({ cron: '20 * * * *' }, env);
    assert.equal(calls.filter((call) => call.url.includes('doubleOptinConfirmation')).length, 1);
    const doiIndex = calls.findIndex((call) => call.url.includes('doubleOptinConfirmation'));
    const markIndex = calls.findIndex((call) => call.body?.data?.['Date rappel opt-in']);
    assert.ok(markIndex > doiIndex);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('automatic reminders reach 100+ unconfirmed signups queued behind 50+ confirmed ones', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const now = Date.now();
  const autoFrom = new Date(now - 100 * 60 * 60 * 1000).toISOString();
  const confirmed = Array.from({ length: 55 }, (_, i) => ({
    email: `confirmed${i}@example.com`,
    signup_at: new Date(now - (90 * 60 - i) * 60 * 1000).toISOString(),
  }));
  const pending = Array.from({ length: 105 }, (_, i) => ({
    email: `pending${i}@example.com`,
    signup_at: new Date(now - (30 * 60 - i) * 60 * 1000).toISOString(),
  }));
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url.includes('/v3/contacts?')) {
      return Response.json({ contacts: confirmed.map(({ email }) => ({ email, listIds: [3] })) });
    }
    if (url.includes('doubleOptinConfirmation')) return new Response('', { status: 201 });
    if (url.includes('script.google.com') && body?.data) return Response.json({ ok: true, mode: 'update' });
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const env = {
      ...productionEnv,
      DB: createReminderDb([...confirmed, ...pending]),
      NEWSLETTER_REMINDER_AUTO_FROM: autoFrom,
    };
    const reminded = () => calls
      .filter((call) => call.url.includes('doubleOptinConfirmation'))
      .map((call) => call.body.email);
    await worker.scheduled({ cron: '20 * * * *' }, env);
    assert.equal(reminded().length, 50);
    assert.ok(reminded().every((email) => email.startsWith('pending')));
    await worker.scheduled({ cron: '20 * * * *' }, env);
    await worker.scheduled({ cron: '20 * * * *' }, env);
    assert.deepEqual(new Set(reminded()), new Set(pending.map(({ email }) => email)));
    assert.equal(reminded().length, 105);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('alert notifications follow the confirmed CRM routing matrix', async () => {
  const originalFetch = globalThis.fetch;
  const env = {
    BREVO_API_KEY: 'test-key',
    NEWSLETTER_INTERNAL_TOKEN: 'test-token',
    NEWSLETTER_SENDER_EMAIL: 'notifications@example.com',
  };
  const cases = [
    {
      name: 'location',
      body: { transac: 'L', bien_a_vendre: false },
      recipients: ['carolinepujol@immobiliere-pujol.fr'],
    },
    {
      name: 'sale search without a property to sell',
      body: { transac: 'V', bien_a_vendre: false },
      recipients: ['carolinepujol@immobiliere-pujol.fr'],
    },
    {
      name: 'sale search with a property to sell',
      body: { transac: 'V', bien_a_vendre: true },
      recipients: [
        'carolinepujol@immobiliere-pujol.fr',
        'benoit@immobiliere-pujol.fr',
      ],
    },
  ];

  try {
    for (const testCase of cases) {
      const sentTo = [];
      globalThis.fetch = async (_input, init = {}) => {
        sentTo.push(JSON.parse(init.body).to[0].email);
        return Response.json({ messageId: 'test-message' }, { status: 201 });
      };

      const response = await worker.fetch(new Request('https://worker.example/alerts/notify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': 'test-token',
        },
        body: JSON.stringify({
          ...testCase.body,
          email: 'prospect@example.com',
          negociateur_email: 'agent@immobiliere-pujol.fr',
        }),
      }), env, {});
      const result = await response.json();

      assert.equal(response.status, 200, testCase.name);
      assert.deepEqual(result.notified, testCase.recipients, testCase.name);
      assert.deepEqual(sentTo, testCase.recipients, testCase.name);
      assert.equal(sentTo.includes('agent@immobiliere-pujol.fr'), false, testCase.name);
      assert.equal(sentTo.includes('annonces@immobiliere-pujol.fr'), false, testCase.name);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('commercial rental contact forms notify the listing contact and keep the CRM parser copy', async () => {
  const originalFetch = globalThis.fetch;
  const sends = [];
  const pending = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('/v3/smtp/email')) {
      const payload = JSON.parse(init.body);
      sends.push(payload);
      return Response.json({ messageId: 'test-message' }, { status: 201 });
    }
    if (url.includes('script.google.com')) return Response.json({ ok: true });
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const body = new FormData();
    body.set('name', 'Camille Martin');
    body.set('email', 'camille@example.com');
    body.set('phone', '0600000000');
    body.set('message', 'Je souhaite visiter ce bureau.');
    body.set('reference', '409neot');
    body.set('title', 'Bureau à louer');
    body.set('type', 'L');
    body.set('code_postal', '13006');
    body.set('negociateur', 'Agent Pujol');
    body.set(
      'negociateur_email',
      'agent@immobiliere-pujol.fr|agent@immobiliere-pujol.fr|agent@immobiliere-pujol.fr',
    );
    body.set('route_to_listing_contact', '1');

    const response = await worker.fetch(new Request('https://worker.example/contact-annonce', {
      method: 'POST',
      headers: { Origin: 'https://www.immobiliere-pujol.fr' },
      body,
    }), productionEnv, { waitUntil(promise) { pending.push(promise); } });
    await Promise.all(pending);

    assert.equal(response.status, 200);
    assert.deepEqual(
      sends
        .filter((payload) => payload.subject.startsWith('Contact Annonce - Location'))
        .map((payload) => payload.to[0].email),
      ['agent@immobiliere-pujol.fr', 'g9f4fx36@parser.eu.zohocrm.com'],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('commercial rental contact routing rejects non-Pujol recipient injection', async () => {
  const originalFetch = globalThis.fetch;
  const sends = [];
  const pending = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('/v3/smtp/email')) {
      const payload = JSON.parse(init.body);
      sends.push(payload);
      return Response.json({ messageId: 'test-message' }, { status: 201 });
    }
    if (url.includes('script.google.com')) return Response.json({ ok: true });
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const body = new FormData();
    body.set('name', 'Camille Martin');
    body.set('email', 'camille@example.com');
    body.set('message', 'Test');
    body.set('reference', '409neot');
    body.set('title', 'Bureau à louer');
    body.set('type', 'L');
    body.set('negociateur_email', 'attacker@example.com');
    body.set('route_to_listing_contact', '1');

    const response = await worker.fetch(new Request('https://worker.example/contact-annonce', {
      method: 'POST',
      headers: { Origin: 'https://www.immobiliere-pujol.fr' },
      body,
    }), productionEnv, { waitUntil(promise) { pending.push(promise); } });
    await Promise.all(pending);

    assert.equal(response.status, 200);
    const destinations = sends.map((payload) => payload.to[0].email);
    assert.equal(destinations.includes('attacker@example.com'), false);
    assert.equal(destinations.includes('annonces@immobiliere-pujol.fr'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('alert confirmation email carries the submitted first and last name', async () => {
  const originalFetch = globalThis.fetch;
  let sentPayload;
  globalThis.fetch = async (_input, init = {}) => {
    sentPayload = JSON.parse(init.body);
    return Response.json({ messageId: 'test-message' }, { status: 201 });
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/alerts/optin', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': 'test-token',
      },
      body: JSON.stringify({
        email: 'prospect@example.com',
        prenom: 'Camille',
        nom: 'Martin',
        criteriaText: 'Location · Appartement · Studio',
        confirmUrl: 'https://example.com/confirm',
      }),
    }), {
      BREVO_API_KEY: 'test-key',
      NEWSLETTER_INTERNAL_TOKEN: 'test-token',
      NEWSLETTER_SENDER_EMAIL: 'notifications@example.com',
    }, {});

    assert.equal(response.status, 200);
    assert.match(sentPayload.htmlContent, /Bonjour Camille Martin,/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('matched-listing emails require the dedicated alert token', async () => {
  const baseEnv = {
    BREVO_API_KEY: 'test-key',
    NEWSLETTER_INTERNAL_TOKEN: 'newsletter-token',
    ALERT_INTERNAL_TOKEN: 'alert-token',
  };
  const body = JSON.stringify({ email: 'prospect@example.com', listings: [{ title: 'Test' }] });

  const newsletterTokenResponse = await worker.fetch(new Request('https://worker.example/alerts/match', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': 'newsletter-token' },
    body,
  }), baseEnv, {});
  assert.equal(newsletterTokenResponse.status, 403);

  const alertTokenWithoutBrevo = await worker.fetch(new Request('https://worker.example/alerts/match', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': 'alert-token' },
    body,
  }), { ...baseEnv, BREVO_API_KEY: undefined }, {});
  assert.equal(alertTokenWithoutBrevo.status, 501);
});

function createGuideDb({ fail = false } = {}) {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      let args = [];
      const st = {
        bind(...v) { args = v; return st; },
        async run() {
          if (fail) throw new Error('D1_ERROR: down');
          if (sql.startsWith('CREATE TABLE')) return { success: true };
          if (sql.startsWith('INSERT INTO guide_requests')) {
            const [created_at, email, prenom, nom, guide, tag, consent] = args;
            rows.push({ id: rows.length + 1, created_at, email, prenom, nom, guide, tag, consent, status: 'received', sheet_ok: 0, lead_ok: 0 });
            return { success: true, meta: { last_row_id: rows.length } };
          }
          if (sql.startsWith('UPDATE guide_requests')) {
            const [status, sheet_ok, lead_ok, id] = args;
            Object.assign(rows[id - 1], { status, sheet_ok, lead_ok });
            return { success: true };
          }
          throw new Error(`unexpected D1 query: ${sql}`);
        },
      };
      return st;
    },
  };
}

async function postGuide(fields, { sheet = () => Response.json({ ok: true, mode: 'append' }), brevo = () => Response.json({ messageId: 'x' }), db = createGuideDb() } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = { sheet: [], mails: [], db };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('script.google.com')) { calls.sheet.push(JSON.parse(init.body)); return sheet(); }
    if (url.includes('/v3/smtp/email')) { const m = JSON.parse(init.body); calls.mails.push(m); return brevo(m); }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    const res = await worker.fetch(new Request('https://worker.example/guide', {
      method: 'POST', headers: { Origin: 'https://www.immobiliere-pujol.fr' }, body,
    }), { ...productionEnv, DB: db }, { waitUntil() {} });
    return { res, json: await res.json(), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}
const GUIDE_OK = { prenom: 'Marie', nom: 'Durand', email: 'bailleur@example.com', guide: 'gerer-seul-cout', consent: '1' };
const toVisitor = (m) => m.to[0].email === 'bailleur@example.com';
const isGuideCopy = (m) => m.subject.startsWith('Copie du guide envoyé à ');
const toLead = (m) => !isGuideCopy(m) && (m.to[0].email === 'g9f4fx36@parser.eu.zohocrm.com' || m.to[0].email === 'carolinepujol@immobiliere-pujol.fr');
const toZoho = (m) => m.to[0].email === 'g9f4fx36@parser.eu.zohocrm.com';

test('guide: refused without consent, names, valid email or a real guide; nothing written or sent', async () => {
  const inherited = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'].map((guide) => ({ ...GUIDE_OK, guide }));
  const { consent, ...noConsent } = GUIDE_OK;
  for (const fields of [noConsent, { ...GUIDE_OK, guide: 'inconnu' }, { ...GUIDE_OK, email: 'pas-un-email' }, { ...GUIDE_OK, prenom: '' }, { ...GUIDE_OK, nom: ' ' }, ...inherited]) {
    const { res, calls } = await postGuide(fields);
    assert.equal(res.status, 400);
    assert.equal(calls.sheet.length + calls.mails.length, 0);
  }
});

test('guide: sent by email (no link in the answer), tagged consent row, tagged lead email', async () => {
  const { res, json, calls } = await postGuide(GUIDE_OK);
  assert.equal(res.status, 200);
  assert.deepEqual(json, { ok: true });
  const visitor = calls.mails.find(toVisitor);
  assert.match(visitor.htmlContent, /https:\/\/www\.immobiliere-pujol\.fr\/guides\/[0-9a-f]{24}\/guide-gerer-seul-ou-deleguer\.pdf/);
  assert.match(visitor.htmlContent, /Bonjour Marie/);
  // Caroline 27/11: Gaëlle's wording, booking link and signature, signed by her.
  assert.match(visitor.htmlContent, /Répondez simplement à cet email\. Gaëlle Lapert, notre experte en gestion locative, vous rappelle\./);
  assert.match(visitor.htmlContent, /calendar\.google\.com\/calendar\/u\/0\/appointments\/schedules\/AcZssZ0fgtiWYuB8b/);
  // Caroline 27/11: 87 is Gaëlle's number, so her signature image (which shows 87) is used.
  assert.match(visitor.htmlContent, /\/images\/email\/signature-gaelle-lapert\.jpg/);
  assert.match(visitor.htmlContent, /<a href="https:\/\/calendar\.google\.com[^"]*"><img /, 'signature image opens her agenda');
  assert.doesNotMatch(visitor.htmlContent, /85 ?20 ?05/);
  assert.match(visitor.htmlContent, />Gaëlle Lapert<\/p>/);
  assert.doesNotMatch(visitor.htmlContent, /L(&#39;|&#x27;|')équipe Immobilière Pujol/, 'signed by Gaëlle, not the team');
  assert.equal(calls.sheet[0].tab, 'Gestion Locative');
  assert.deepEqual(calls.sheet[0].row.slice(1, 5), ['Marie', 'Durand', '', 'bailleur@example.com']);
  assert.match(calls.sheet[0].row[5], /^Demande guide gestion - gérer seul \|/);
  assert.match(calls.sheet[0].row[5], /J'accepte de recevoir gratuitement ce guide/);
  const leads = calls.mails.filter(toLead);
  assert.deepEqual(leads.map((m) => m.to[0].email).sort(), ['carolinepujol@immobiliere-pujol.fr', 'g9f4fx36@parser.eu.zohocrm.com']);
  for (const lead of leads) {
    assert.equal(lead.subject, '[Demande guide gestion - gérer seul] Gérer seul ou déléguer ? | Marie Durand');
    assert.match(lead.htmlContent, /Guide envoyé[\s\S]*Gérer seul ou déléguer \?/);
  }
  assert.equal(leads[0].replyTo.email, 'bailleur@example.com');
  assert.ok(!calls.mails.some((m) => m.to[0].email === 'gaelle@immobiliere-pujol.fr'), 'no longer to Gaëlle (Caroline 20/11)');
  assert.equal(calls.mails.indexOf(visitor), 0, 'guide email goes first');
  const copies = calls.mails.filter(isGuideCopy);
  assert.equal(copies.length, 1, 'Caroline gets one copy of the visitor email (Roy 27/11)');
  assert.equal(copies[0].to[0].email, 'carolinepujol@immobiliere-pujol.fr');
  assert.equal(copies[0].subject, 'Copie du guide envoyé à Marie Durand (bailleur@example.com) : Gérer seul ou déléguer ?');
  assert.equal(copies[0].htmlContent, visitor.htmlContent, 'same content as the visitor email');
  assert.ok(!visitor.cc, 'Caroline is not visible to the visitor');
  assert.equal(calls.mails.length, 4, 'visitor + copy + Zoho lead + Caroline lead');
});

test('guide: the second guide carries its own exact title to Zoho and Caroline', async () => {
  const { res, calls } = await postGuide({ ...GUIDE_OK, guide: 'gerer-seul-risque' });
  assert.equal(res.status, 200);
  const leads = calls.mails.filter(toLead);
  assert.equal(leads.length, 2);
  for (const lead of leads) {
    assert.equal(lead.subject, '[Demande guide gestion - gérer seul] Gérer seul : vous portez le risque | Marie Durand');
    assert.match(lead.htmlContent, /Guide envoyé[\s\S]*Gérer seul : vous portez le risque/);
  }
});

test('guide: if the guide email is refused or the network fails, 502 and nothing recorded', async () => {
  for (const brevo of [() => new Response('{}', { status: 400 }), () => { throw new TypeError('network'); }]) {
    const { res, json, calls } = await postGuide(GUIDE_OK, { brevo });
    assert.equal(res.status, 502);
    assert.equal(json.ok, false);
    assert.equal(calls.sheet.length, 0);
    assert.equal(calls.mails.filter(toLead).length, 0, 'no lead email, so a retry never duplicates it');
  }
});

test('guide: Sheet failures after a sent guide still answer ok and flag it in the lead email', async () => {
  const failures = [
    () => new Response('down', { status: 503 }),
    () => Response.json({ ok: false, error: 'Tab not found' }),
    () => new Response('<html>not json</html>', { status: 200 }),
    () => { throw new TypeError('network'); },
  ];
  for (const sheet of failures) {
    const { res, calls } = await postGuide(GUIDE_OK, { sheet });
    assert.equal(res.status, 200);
    assert.match(calls.mails.find(toLead).htmlContent, /NON, à saisir à la main/);
  }
  const leadFails = await postGuide(GUIDE_OK, { brevo: (m) => toLead(m) ? new Response('{}', { status: 500 }) : Response.json({ messageId: 'x' }) });
  assert.equal(leadFails.res.status, 200);
  assert.equal(leadFails.calls.sheet.length, 1);
});

test('guide: durable D1 record before sending; Sheet and the Zoho/Caroline leads all down still keeps the request', async () => {
  const { res, calls } = await postGuide(GUIDE_OK, {
    sheet: () => new Response('down', { status: 503 }),
    brevo: (m) => toLead(m) ? new Response('{}', { status: 503 }) : Response.json({ messageId: 'x' }),
  });
  assert.equal(res.status, 200, 'the guide was sent, so the visitor is told so');
  assert.equal(calls.db.rows.length, 1);
  assert.deepEqual(
    { email: calls.db.rows[0].email, prenom: calls.db.rows[0].prenom, nom: calls.db.rows[0].nom, tag: calls.db.rows[0].tag, status: calls.db.rows[0].status, sheet_ok: calls.db.rows[0].sheet_ok, lead_ok: calls.db.rows[0].lead_ok },
    { email: 'bailleur@example.com', prenom: 'Marie', nom: 'Durand', tag: 'Demande guide gestion - gérer seul', status: 'sent', sheet_ok: 0, lead_ok: 0 },
  );
  assert.match(calls.db.rows[0].consent, /J'accepte de recevoir gratuitement ce guide/);
});

test('guide: if the D1 record fails, nothing is sent (503)', async () => {
  const { res, calls } = await postGuide(GUIDE_OK, { db: createGuideDb({ fail: true }) });
  assert.equal(res.status, 503);
  assert.equal(calls.mails.length + calls.sheet.length, 0);
});

test('guide: refused guide email leaves the D1 row as send_failed', async () => {
  const { res, calls } = await postGuide(GUIDE_OK, { brevo: () => new Response('{}', { status: 400 }) });
  assert.equal(res.status, 502);
  assert.equal(calls.db.rows[0].status, 'send_failed');
});

test('guide: a failed copy to Caroline (refused or network) changes nothing for the visitor or the leads', async () => {
  for (const fail of [() => new Response('{}', { status: 500 }), () => { throw new TypeError('network'); }]) {
    const { res, json, calls } = await postGuide(GUIDE_OK, { brevo: (m) => isGuideCopy(m) ? fail() : Response.json({ messageId: 'x' }) });
    assert.equal(res.status, 200);
    assert.deepEqual(json, { ok: true });
    assert.equal(calls.mails.filter(isGuideCopy).length, 1, 'the copy was attempted');
    assert.deepEqual(calls.mails.filter(toLead).map((m) => m.to[0].email).sort(), ['carolinepujol@immobiliere-pujol.fr', 'g9f4fx36@parser.eu.zohocrm.com']);
    assert.equal(calls.sheet.length, 1);
    assert.deepEqual({ status: calls.db.rows[0].status, sheet_ok: calls.db.rows[0].sheet_ok, lead_ok: calls.db.rows[0].lead_ok }, { status: 'sent', sheet_ok: 1, lead_ok: 1 });
  }
});

test('Gaëlle signature: image mode keeps the clickable signature image, text mode her phone (87, Caroline 27/11)', () => {
  const img = gaelleSignatureHtml('https://example.test', 'image');
  assert.match(img, /https:\/\/example\.test\/images\/email\/signature-gaelle-lapert\.jpg/);
  assert.match(img, /<a href="https:\/\/calendar\.google\.com\/calendar\/u\/0\/appointments\/schedules\//);
  const text = gaelleSignatureHtml('https://example.test', 'text');
  assert.match(text, /href="tel:0608872005"/);
  assert.match(text, /gaelle@immobiliere-pujol\.fr/);
  assert.doesNotMatch(text, /85 ?20 ?05/);
});
