import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import worker from './index.ts';

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
        bind(...values) { args = values; return statement; },
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
              .slice(0, 50) };
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
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes('doubleOptinConfirmation')) return new Response('', { status: 201 });
    if (url.includes('script.google.com')) return Response.json({ ok: true, mode: 'insert' });
    if (url.includes('mandrillapp.com')) return Response.json([{ status: 'sent' }]);
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
      recipients: ['g9f4fx36@parser.eu.zohocrm.com', 'carolinepujol@immobiliere-pujol.fr'],
    },
    {
      name: 'sale search without a property to sell',
      body: { transac: 'V', bien_a_vendre: false },
      recipients: ['g9f4fx36@parser.eu.zohocrm.com', 'carolinepujol@immobiliere-pujol.fr'],
    },
    {
      name: 'sale search with a property to sell',
      body: { transac: 'V', bien_a_vendre: true },
      recipients: [
        'g9f4fx36@parser.eu.zohocrm.com',
        'carolinepujol@immobiliere-pujol.fr',
        'benoit@immobiliere-pujol.fr',
      ],
    },
    {
      name: 'future location path with a property to sell',
      body: { transac: 'L', bien_a_vendre: true },
      recipients: [
        'g9f4fx36@parser.eu.zohocrm.com',
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
