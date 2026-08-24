import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import worker from './index.ts';

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
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'sheet-token' }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, value) => [...crypto.createHash('sha256').update(String(value)).digest()],
    },
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

  const forbidden = context.doPost({ postData: { contents: JSON.stringify({
    action: 'listPendingNewsletterReminders', tab: 'Newsletter', token: 'wrong',
  }) } });
  assert.deepEqual(JSON.parse(forbidden.getContent()), { ok: false, error: 'Forbidden' });

  const pending = context.doPost({ postData: { contents: JSON.stringify({
    action: 'listPendingNewsletterReminders', tab: 'Newsletter', token: 'sheet-token',
  }) } });
  assert.deepEqual(JSON.parse(pending.getContent()), {
    ok: true,
    records: [{ email: 'other@example.com', signupAt: '03/08/2026', reminderAt: '' }],
  });
});

test('one-time DOI reminder dry run excludes confirmed and already-reminded contacts', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('script.google.com')) return Response.json({
      ok: true,
      records: [
        { email: 'eligible@example.com', signupAt: '22/07/2026 10:00:00', reminderAt: '' },
        { email: 'confirmed@example.com', signupAt: '23/07/2026 10:00:00', reminderAt: '' },
        { email: 'reminded@example.com', signupAt: '24/07/2026 10:00:00', reminderAt: '25/07/2026 10:00:00' },
        { email: 'reminded@example.com', signupAt: '24/07/2026 10:00:00', reminderAt: '' },
      ],
    });
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
      SHEET_INTERNAL_TOKEN: 'sheet-token',
    }, {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      dryRun: true,
      requested: 4,
      eligible: 1,
      excludedConfirmed: 1,
      excludedNotPending: 1,
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
    if (url.includes('script.google.com') && body?.action) return Response.json({
      ok: true,
      records: [{ email: 'eligible@example.com', signupAt: '22/07/2026 10:00:00', reminderAt: '' }],
    });
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
      SHEET_INTERNAL_TOKEN: 'sheet-token',
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
    if (url.includes('script.google.com') && body?.action) return Response.json({
      ok: true,
      records: [{ email: 'future@example.com', signupAt, reminderAt: '' }],
    });
    if (url.includes('doubleOptinConfirmation')) return new Response('', { status: 201 });
    if (url.includes('script.google.com') && body?.data) return Response.json({ ok: true, mode: 'update' });
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    await worker.scheduled({ cron: '20 * * * *' }, {
      ...productionEnv,
      SHEET_INTERNAL_TOKEN: 'sheet-token',
      NEWSLETTER_REMINDER_AUTO_FROM: autoFrom,
    });
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
