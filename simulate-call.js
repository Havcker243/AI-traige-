const { setTimeout: sleep } = require('node:timers/promises');
const { emitEvent } = require('./events');
const { TEST_TRANSFER_NUMBER } = require('./transfer-config');

// Clinic-local (America/New_York) wall-clock hour tomorrow, as a UTC instant.
function clinicLocalTomorrowAt(hour) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(tomorrow);
  const guess = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);
  const offsetMinutes = (new Date(guess.toLocaleString('en-US', { timeZone: 'America/New_York' })) - guess) / 60000;
  return new Date(guess.getTime() - offsetMinutes * 60000);
}

async function simulateCall({ scenario, delayMs = 900, emit = emitEvent, callId: requestedCallId } = {}) {
  if (!['routine', 'emergency'].includes(scenario)) {
    throw new Error('scenario must be routine or emergency');
  }

  const callId = requestedCallId || `sim-${Date.now()}`;
  const step = async (type, data = {}) => {
    emit(type, callId, data);
    if (delayMs > 0) await sleep(delayMs);
  };
  const speech = (role, status) => step('speech', { role, status });
  const transcript = (role, text, transcriptType = 'final') =>
    step('transcript', { role, transcriptType, text });
  const llmRequest = tools => step('llm.request', {
    model: 'gpt-4o-mini',
    messageCount: 5,
    tools
  });
  const llmResponse = (finishReason, toolCalls, contentPreview, latencyMs = 180) =>
    step('llm.response', { finishReason, toolCalls, contentPreview, latencyMs });

  await step('call.started', { callerPhone: '+15550100200' });
  await step('status', { status: 'in-progress' });
  await speech('assistant', 'started');
  await speech('assistant', 'stopped');

  if (scenario === 'routine') {
    await speech('user', 'started');
    await transcript('user', 'Hi, I\'ve had a sore throat and a fever for two days', 'partial');
    await transcript('user', 'Hi, I\'ve had a sore throat and a fever for two days');
    await speech('user', 'stopped');
    await step('turn.received', {
      messageCount: 3,
      lastUserMessage: 'Hi, I\'ve had a sore throat and a fever for two days',
      stream: false
    });
    await llmRequest(['transferCall', 'book_appointment', 'save_patient_info', 'set_disposition']);
    await llmResponse('stop', [], 'I\'m sorry to hear that. Any trouble breathing or swallowing?');
    await step('response.sent', { stream: false, finishReason: 'stop' });
    await step('db.saved', { op: 'transcript' });
    await speech('assistant', 'started');
    await speech('assistant', 'stopped');

    await speech('user', 'started');
    await transcript('user', 'No, just painful. My name is Jamie Lee, I\'m 34.');
    await speech('user', 'stopped');
    await step('turn.received', {
      messageCount: 6,
      lastUserMessage: 'No, just painful. My name is Jamie Lee, I\'m 34.',
      stream: false
    });
    await llmRequest(['transferCall', 'book_appointment', 'save_patient_info', 'set_disposition']);
    await llmResponse('tool_calls', ['save_patient_info'], null);
    await step('tool.started', { name: 'save_patient_info', args: { name: 'Jamie Lee', age: '34' } });
    await step('tool.finished', { name: 'save_patient_info', success: true, result: { success: true }, latencyMs: 90 });
    await step('db.saved', { op: 'patient' });
    await llmResponse('tool_calls', ['set_disposition'], null);
    await step('tool.started', {
      name: 'set_disposition',
      args: { disposition: 'routine', chiefComplaint: 'sore throat and fever, 2 days' }
    });
    await step('tool.finished', { name: 'set_disposition', success: true, result: { success: true }, latencyMs: 90 });
    await step('db.saved', { op: 'disposition' });
    await llmResponse(
      'stop',
      [],
      'This sounds routine. Would you like me to book the next available appointment with Doctor Moyo?'
    );
    await step('response.sent', { stream: false, finishReason: 'stop' });
    await speech('assistant', 'started');
    await speech('assistant', 'stopped');

    await speech('user', 'started');
    await transcript('user', 'Yes please, and text me at +1 555 010 0200');
    await speech('user', 'stopped');
    await step('turn.received', {
      messageCount: 9,
      lastUserMessage: 'Yes please, book me in',
      stream: false
    });
    await llmRequest(['transferCall', 'book_appointment', 'save_patient_info', 'set_disposition']);
    await llmResponse('tool_calls', ['book_appointment'], null);
    await step('tool.started', {
      name: 'book_appointment',
      args: { callerName: 'Jamie Lee' }
    });
    const appointmentTime = clinicLocalTomorrowAt(10);
    await step('tool.finished', {
      name: 'book_appointment',
      success: true,
      result: {
        appointmentTime: appointmentTime.toISOString(),
        timeZone: 'America/New_York',
        location: 'MIT School of Nursing, Left Wing',
        doctorName: 'Doctor Moyo'
      },
      latencyMs: 240
    });
    await step('db.saved', { op: 'booking' });
    await llmResponse('stop', [], 'You\'re booked for tomorrow at 10 AM with Doctor Moyo.');
    await step('response.sent', { stream: false, finishReason: 'stop' });
    await speech('assistant', 'started');
    await speech('assistant', 'stopped');
    await step('status', { status: 'ended' });
    await step('call.ended', {
      reason: 'customer-ended-call',
      durationSeconds: 212,
      summary: 'Routine sore throat; appointment booked.'
    });
    await step('db.saved', { op: 'end_of_call_report' });
    return callId;
  }

  await speech('user', 'started');
  await transcript('user', 'My dad suddenly has crushing chest pain and his left arm is numb');
  await speech('user', 'stopped');
  await step('turn.received', {
    messageCount: 3,
    lastUserMessage: 'My dad suddenly has crushing chest pain and his left arm is numb',
    stream: false
  });
  await llmRequest(['transferCall', 'book_appointment', 'save_patient_info', 'set_disposition']);
  await llmResponse('tool_calls', ['set_disposition'], null);
  await step('tool.started', {
    name: 'set_disposition',
    args: { disposition: 'emergency', chiefComplaint: 'sudden crushing chest pain' }
  });
  await step('tool.finished', { name: 'set_disposition', success: true, result: { success: true }, latencyMs: 90 });
  await step('db.saved', { op: 'disposition' });
  await llmResponse('tool_calls', ['save_patient_info'], null);
  await step('tool.started', {
    name: 'save_patient_info',
    args: { address: '77 Massachusetts Ave, Cambridge' }
  });
  await step('tool.finished', { name: 'save_patient_info', success: true, result: { success: true }, latencyMs: 90 });
  await step('db.saved', { op: 'patient' });
  await llmResponse('tool_calls', ['transferCall'], null);
  await step('transfer.returned', { destination: TEST_TRANSFER_NUMBER, toolCallId: `sim-transfer-${Date.now()}` });
  await step('response.sent', { stream: false, finishReason: 'tool_calls' });
  await speech('assistant', 'started');
  await step('transcript', {
    role: 'assistant',
    transcriptType: 'final',
    text: 'I am transferring you to the emergency operator now'
  });
  await speech('assistant', 'stopped');
  await step('status', { status: 'ended' });
  await step('call.ended', { reason: 'assistant-forwarded-call' });
  await step('db.saved', { op: 'end_of_call_report' });
  return callId;
}

module.exports = { simulateCall };
