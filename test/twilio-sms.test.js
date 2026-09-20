const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sendBookingConfirmation, buildConfirmation, normalizePhone } = require('../twilio-sms');

const booking = { start: '2026-10-01T14:00:00Z', timeZone: 'America/New_York', location: '123 Example Street' };
const env = { TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: 'test-token', TWILIO_FROM_NUMBER: '+17372583742' };
const input = { booking, to: '+1 (202) 555-0101', consent: true };

test('sends appointment details to Twilio with Basic auth and form-encoded body', async () => {
  let request;
  const result = await sendBookingConfirmation(input, { env, fetchImpl: async (url, options) => {
    request = { url, ...options };
    return { ok: true, json: async () => ({ sid: 'SMtest', status: 'queued' }) };
  } });
  assert.equal(request.url, 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
  assert.equal(request.headers.Authorization, `Basic ${Buffer.from('ACtest:test-token').toString('base64')}`);
  assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(request.body.toString());
  assert.equal(body.get('From'), '+17372583742');
  assert.equal(body.get('To'), '+12025550101');
  assert.match(body.get('Body'), /10:00 AM.*America\/New_York/);
  assert.match(body.get('Body'), /Location: MIT School of Nursing, Left Wing/);
  assert.doesNotMatch(body.get('Body'), /123 Example Street/);
  assert.match(body.get('Body'), /Doctor Moyo/);
  assert.equal(result.status, 'submitted');
  assert.equal(result.messageId, 'SMtest');
});

test('does not send without explicit consent, a valid phone, or Twilio configuration', async () => {
  const fetchImpl = () => { throw new Error('Must not send'); };
  assert.equal((await sendBookingConfirmation({ ...input, consent: false }, { env, fetchImpl })).status, 'skipped');
  assert.equal((await sendBookingConfirmation({ ...input, consent: 'true' }, { env, fetchImpl })).status, 'skipped');
  assert.equal((await sendBookingConfirmation({ ...input, to: '2025550101' }, { env, fetchImpl })).status, 'skipped');
  assert.equal((await sendBookingConfirmation(input, { env: { TWILIO_ACCOUNT_SID: 'ACtest' }, fetchImpl })).status, 'unavailable');
  assert.equal((await sendBookingConfirmation(input, { env: { ...env, TWILIO_FROM_NUMBER: undefined }, fetchImpl })).status, 'unavailable');
});

test('handles rejection and ambiguous timeout without retries or delivery claims', async () => {
  let attempts = 0;
  const result = await sendBookingConfirmation(input, { env, fetchImpl: async () => { attempts++; throw new Error('timeout'); } });
  assert.equal(result.status, 'unknown');
  assert.equal(attempts, 1);
  assert.equal((await sendBookingConfirmation(input, {
    env, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ message: 'Invalid number' }) })
  })).status, 'failed');
  assert.equal((await sendBookingConfirmation(input, {
    env, fetchImpl: async () => ({ ok: true, json: async () => ({ sid: 'SMtest', status: 'failed' }) })
  })).status, 'failed');
});

test('reports delivery only on confirmed delivered response', async () => {
  const result = await sendBookingConfirmation(input, {
    env, fetchImpl: async () => ({ ok: true, json: async () => ({ sid: 'SMtest', status: 'delivered' }) })
  });
  assert.equal(result.status, 'delivered');
});

test('normalizePhone rejects malformed numbers', () => {
  assert.equal(normalizePhone('2025550101'), null);
  assert.equal(normalizePhone('+1 (202) 555-0101'), '+12025550101');
});
