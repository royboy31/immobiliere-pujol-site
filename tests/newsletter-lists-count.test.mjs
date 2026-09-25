import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../workers/email/index.ts';

// /newsletter/lists feeds the composer's audience headcount. Brevo's
// totalSubscribers already excludes blacklisted contacts, so subtracting
// totalBlacklisted again under-counts (Roy saw 1 003 for a real 1 047).

const TOKEN = 'test-internal-token';

async function listsCount(brevoList) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(brevoList), { status: 200 });
  try {
    const res = await worker.fetch(
      new Request('https://pujol-email.test/newsletter/lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': TOKEN },
        body: '{}',
      }),
      { NEWSLETTER_INTERNAL_TOKEN: TOKEN, BREVO_API_KEY: 'k', NEWSLETTER_LIST_IDS: '3:Abonnés' },
      { waitUntil() {} },
    );
    assert.equal(res.status, 200);
    return (await res.json()).lists[0].count;
  } finally {
    globalThis.fetch = original;
  }
}

test('count is totalSubscribers as-is, blacklisted not subtracted twice', async () => {
  assert.equal(await listsCount({ totalSubscribers: 1047, uniqueSubscribers: 1091, totalBlacklisted: 44 }), 1047);
});

test('without totalSubscribers, count falls back to unique minus blacklisted', async () => {
  assert.equal(await listsCount({ uniqueSubscribers: 1091, totalBlacklisted: 44 }), 1047);
});
