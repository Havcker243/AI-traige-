const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeTool, resolveCompletion } = require('../server');
const tool = (name, args) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('same-turn booking reads patient only after a delayed save finishes', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let patient;
  let booked = false;
  let delivered;
  let resolveEmail;
  const email = new Promise(resolve => { resolveEmail = resolve; });
  const deps = {
    savePatientInfo: async (_id, info) => { await pending; patient = info; return true; },
    getPatientInfo: async () => patient,
    createBooking: async () => { booked = true; return { start: '2026-10-01T12:00:00Z' }; },
    recordBooking: async () => {},
    sendDoctorNotes: async args => { delivered = args.patient; resolveEmail(); },
    sendPatientConfirmationEmail: async () => {},
    sendBookingConfirmation: async () => ({ status: 'skipped' })
  };
  let turns = 0;
  const completion = resolveCompletion({ messages: [] }, { callId: 'test', messages: [] }, {
    callOpenAI: async () => ({ choices: [turns++ === 0
      ? { finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [tool('save_patient_info', { name: 'Test Patient', age: 43 }), tool('book_appointment', { callerName: 'Test Patient', smsConsent: false })] } }
      : { finish_reason: 'stop', message: { content: 'Booked' } }] }),
    executeTool: (call, context) => executeTool(call, context, deps)
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(booked, false);
  release();
  await completion;
  await email;
  assert.equal(delivered.name, 'Test Patient');
  assert.equal(delivered.age, 43);
});

test('failed or unavailable patient persistence does not report success', async () => {
  for (const savePatientInfo of [async () => false, async () => { throw new Error('Test database unavailable'); }]) {
    const result = JSON.parse(await executeTool(tool('save_patient_info', { name: 'Test' }), {}, { savePatientInfo }));
    assert.equal(result.success, false);
  }
});
