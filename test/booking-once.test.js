const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeTool } = require('../server');
const { recentEvents } = require('../events');
const tool = { function: { name: 'book_appointment', arguments: '{"callerName":"Test"}' } };
test('concurrent and later duplicate requests book and notify only once, even if email fails', async () => {
  let bookings = 0, patientEmails = 0, doctorEmails = 0;
  const callId = 'booking-dedup-test';
  const deps = {
    createBooking: async () => { bookings++; return { start: '2026-10-01T12:00:00Z', timeZone: 'America/New_York' }; },
    recordBooking: async () => {}, getPatientInfo: async () => ({}),
    sendDoctorNotes: async () => { doctorEmails++; },
    sendPatientConfirmationEmail: async () => { patientEmails++; throw Error('Mock email rejection'); }
  };
  const results = await Promise.all([1, 2].map(() => executeTool(tool, { callId, messages: [] }, deps)));
  results.push(await executeTool(tool, { callId, messages: [] }, deps));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(bookings, 1);
  assert.equal(patientEmails, 1);
  assert.equal(doctorEmails, 1);
  assert.ok(results.every(result => result === results[0] && JSON.parse(result).success));
  assert.ok(recentEvents().some(e => e.callId === callId && e.type === 'email.status' && e.data.status === 'failed'));
});
