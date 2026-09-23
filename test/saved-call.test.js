const { test } = require('node:test');
const assert = require('node:assert/strict');
test('saved record loads patient, appointment and final transcript without live events', async () => {
  const { savedCall } = await import('../frontend/src/lib/savedCall.js');
  const call = savedCall({ callId: 'old', status: 'completed', patient: { name: 'Test' }, bookingUid: 'booking', appointmentTime: '2026-10-01T12:00:00Z', transcript: [{role:'assistant',content:'Unspoken output'}], vapiReport: {artifact: {messages: [{role:'system',message:'private prompt'}, {role:'user',message:'Hello'}, {role:'bot',message:'Hi'}]}} });
  assert.equal(call.patient.name, 'Test');
  assert.equal(call.status, 'ended');
  assert.deepEqual(call.transcript.map(m=>m.text), ['Hello','Hi']);
  assert.equal(call.booking.appointmentTime, '2026-10-01T12:00:00Z');
  assert.deepEqual(call.events, []);
});
test('partial saved records still display their stored conversation', async () => {
 const { savedCall } = await import('../frontend/src/lib/savedCall.js');
 const call = savedCall({callId:'partial',transcript:[{role:'user',content:'Saved words'}]});
 assert.equal(call.transcript[0].text,'Saved words');
 assert.equal(call.booking,null);
});
