const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sendBookingConfirmation, buildConfirmation } = require('../agentphone-sms');
const { executeTool, buildOpenAIBody } = require('../server');

const booking = { start: '2026-10-01T14:00:00Z', timeZone: 'America/New_York', location: '123 Example Street' };
const env = { AGENTPHONE_API_KEY: 'test-only-key' };
const input = { booking, to: '+1 (202) 555-0101', consent: true };

test('sends appointment details to AgentPhone with normalized recipient and configured sender', async () => {
  let request;
  const result = await sendBookingConfirmation(input, { env, fetchImpl: async (url, options) => {
    request = { url, ...options };
    return { ok: true, json: async () => ({ id: 'msg_test', status: 'queued', channel: 'sms' }) };
  } });
  assert.equal(request.url, 'https://api.agentphone.ai/v1/messages');
  assert.equal(request.headers.Authorization, 'Bearer test-only-key');
  const body = JSON.parse(request.body);
  assert.equal(body.from_number, '+13142540585');
  assert.equal(body.to_number, '+12025550101');
  assert.match(body.body, /10:00 AM.*America\/New_York/);
  assert.match(body.body, /Location: MIT School of Nursing, Left Wing/);
  assert.doesNotMatch(body.body, /123 Example Street/);
  assert.match(body.body, /Doctor Moyo/);
  assert.equal(result.status, 'submitted');
});

test('does not send without explicit consent, a valid phone, or AgentPhone configuration', async () => {
  const fetchImpl = () => { throw new Error('Must not send'); };
  assert.equal((await sendBookingConfirmation({ ...input, consent: false }, { env, fetchImpl })).status, 'skipped');
  assert.equal((await sendBookingConfirmation({ ...input, consent: 'true' }, { env, fetchImpl })).status, 'skipped');
  assert.equal((await sendBookingConfirmation({ ...input, to: '2025550101' }, { env, fetchImpl })).status, 'skipped');
  assert.equal((await sendBookingConfirmation(input, { env: { AGENTCALL_API_KEY: 'wrong-provider' }, fetchImpl })).status, 'unavailable');
});

test('handles rejection and ambiguous timeout without retries or delivery claims', async () => {
  let attempts = 0;
  const result = await sendBookingConfirmation(input, { env, fetchImpl: async () => { attempts++; throw new Error('timeout'); } });
  assert.equal(result.status, 'unknown');
  assert.equal(attempts, 1);
  assert.equal((await sendBookingConfirmation(input, { env, fetchImpl: async () => ({ ok: false, status: 403 }) })).status, 'failed');
  assert.equal((await sendBookingConfirmation(input, { env, fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'msg_test', status: 'failed' }) }) })).status, 'failed');
});

test('reports delivery only on confirmed delivered response and supports a sender override', async () => {
  const result = await sendBookingConfirmation(input, { env: { ...env, AGENTPHONE_FROM_NUMBER: '+12025550102' }, fetchImpl: async (_url, options) => {
    assert.equal(JSON.parse(options.body).from_number, '+12025550102');
    return { ok: true, json: async () => ({ id: 'msg_test', status: 'delivered' }) };
  } });
  assert.equal(result.status, 'delivered');
  assert.match(buildConfirmation({ ...booking, location: undefined }), /MIT School of Nursing, Left Wing/);
});

function tool(args) {
  return { function: { name: 'book_appointment', arguments: JSON.stringify({ callerName: 'Test Caller', ...args }) } };
}
const context = { messages: [], callerPhone: '+12025550103' };

test('booking sends custom email and never invokes SMS, even with old SMS arguments', async () => {
  for (const args of [{}, { smsConsent: true, smsPhone: input.to }]) {
    let emails = 0;
    let texts = 0;
    const result = JSON.parse(await executeTool(tool(args), context, {
      createBooking: async () => booking,
      sendDoctorNotes: async () => {},
      getPatientInfo: async () => ({}),
      recordBooking: async () => {},
      sendPatientConfirmationEmail: async value => { assert.equal(value, booking); emails++; },
      sendBookingConfirmation: async () => { texts++; }
    }));
    assert.equal(result.success, true);
    assert.equal(emails, 1);
    assert.equal(texts, 0);
    assert.equal(result.sms, undefined);
  }
});

test('failed booking never sends confirmation email', async () => {
  let emails = 0;
  const result = JSON.parse(await executeTool(tool({}), context, {
    createBooking: async () => { throw new Error('No slots'); },
    sendPatientConfirmationEmail: async () => { emails++; }
  }));
  assert.equal(result.success, false);
  assert.equal(emails, 0);
});

test('email failure does not undo or repeat the booking', async () => {
  let bookings = 0;
  const result = JSON.parse(await executeTool(tool({}), context, {
    createBooking: async () => { bookings++; return booking; },
    sendDoctorNotes: async () => {}, getPatientInfo: async () => ({}), recordBooking: async () => {},
    sendPatientConfirmationEmail: async () => { throw new Error('Test email failure'); }
  }));
  assert.equal(result.success, true);
  assert.equal(bookings, 1);
});

test('runtime instructions update existing Vapi prompts and preserve caller messages', () => {
  const body = buildOpenAIBody({ messages: [{ role: 'system', content: 'Old prompt' }, { role: 'user', content: 'Hello' }], customer: { number: input.to } });
  assert.ok(body.messages.some(m => m.role === 'system' && m.content.startsWith('Booking update:')));
  assert.equal(body.messages.at(-1).content, 'Hello');
  assert.equal(body.customer, undefined);
});
