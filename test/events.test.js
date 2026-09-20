const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { emitEvent, subscribe, recentEvents } = require('../events');
const { simulateCall } = require('../simulate-call');
const { TEST_TRANSFER_NUMBER } = require('../transfer-config');
const { app, resolveCompletion } = require('../server');

function listen() {
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

test('event bus emits timestamped incrementing events and bounds recent history', () => {
  const received = [];
  const unsubscribe = subscribe((event) => received.push(event));
  const first = emitEvent('test.first', 'event-test');
  const second = emitEvent('test.second', 'event-test');
  unsubscribe();

  assert.equal(second.id, first.id + 1);
  assert.match(first.ts, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(received, [first, second]);

  for (let i = 0; i < 501; i++) emitEvent('test.bound', `bound-${i}`);
  assert.equal(recentEvents().length, 500);
});

test('simulated calls produce routine and emergency observability sequences', async () => {
  const routine = [];
  const routineCallId = await simulateCall({ scenario: 'routine', delayMs: 0, emit: (...args) => {
    routine.push({ type: args[0], callId: args[1], data: args[2] });
  } });
  assert.equal(routine[0].type, 'call.started');
  assert.equal(routine.at(-1).type, 'db.saved');
  assert.equal(routine.at(-1).data.op, 'end_of_call_report');
  assert.ok(routine.some((event) => event.type === 'call.ended' && event.callId === routineCallId));
  assert.ok(routine.some((event) => event.type === 'tool.finished'
    && event.data.name === 'book_appointment' && event.data.success === true));

  const emergency = [];
  await simulateCall({ scenario: 'emergency', delayMs: 0, emit: (...args) => {
    emergency.push({ type: args[0], callId: args[1], data: args[2] });
  } });
  assert.ok(emergency.some((event) => event.type === 'transfer.returned'
    && event.data.destination === TEST_TRANSFER_NUMBER));
  assert.equal(emergency.some((event) => event.data.name === 'book_appointment'), false);
});

test('webhook events include transcripts and deduplicate ended calls', async () => {
  const server = await listen();
  const port = server.address().port;
  const transcriptResponse = await fetch(`http://127.0.0.1:${port}/vapi/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        type: 'transcript',
        role: 'user',
        transcriptType: 'final',
        transcript: 'hello',
        call: { id: 'c1' }
      }
    })
  });
  assert.equal(transcriptResponse.status, 200);
  const statusResponse = await fetch(`http://127.0.0.1:${port}/vapi/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: { type: 'status-update', status: 'ended', call: { id: 'c1' } }
    })
  });
  assert.equal(statusResponse.status, 200);
  const events = recentEvents().filter((event) => event.callId === 'c1');
  assert.ok(events.some((event) => event.type === 'webhook.received'));
  assert.ok(events.some((event) => event.type === 'transcript' && event.data.text === 'hello'));
  assert.equal(events.filter((event) => event.type === 'call.ended').length, 1);

  const reportResponse = await fetch(`http://127.0.0.1:${port}/vapi/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        type: 'end-of-call-report',
        endedReason: 'customer-ended-call',
        durationSeconds: 212,
        summary: 'Routine sore throat',
        call: { id: 'c1' }
      }
    })
  });
  assert.equal(reportResponse.status, 200);
  const after = recentEvents().filter((event) => event.callId === 'c1');
  assert.equal(after.filter((event) => event.type === 'call.ended').length, 1);
  const summary = after.find((event) => event.type === 'call.summary');
  assert.deepEqual(summary.data, { reason: 'customer-ended-call', durationSeconds: 212, summary: 'Routine sore throat' });
  await new Promise((resolve) => server.close(resolve));
});

test('SSE events endpoint starts with a snapshot and closes cleanly', async () => {
  const server = await listen();
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/events`, {
    signal: controller.signal
  });
  const { value } = await response.body.getReader().read();
  const firstChunk = Buffer.from(value).toString();
  assert.match(firstChunk, /^event: snapshot\ndata: /);
  const snapshot = JSON.parse(firstChunk.split('\n')[1].slice('data: '.length));
  assert.ok(Array.isArray(snapshot.events));
  controller.abort();
  await new Promise((resolve) => server.close(resolve));
});

test('resolveCompletion emits LLM and tool lifecycle events in order', async () => {
  const callId = 'instrumented-call';
  const events = [];
  const unsubscribe = subscribe((event) => {
    if (event.callId === callId) events.push(event.type);
  });
  let calls = 0;
  await resolveCompletion({ model: 'gpt-4o-mini', messages: [], tools: [] }, { callId }, {
    callOpenAI: async () => {
      calls++;
      if (calls === 1) {
        return {
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [{
                id: 'tool-1',
                function: { name: 'set_disposition', arguments: '{"disposition":"routine"}' }
              }]
            }
          }]
        };
      }
      return { choices: [{ finish_reason: 'stop', message: { content: 'done' } }] };
    },
    executeTool: async () => '{"success":true}'
  });
  unsubscribe();

  assert.deepEqual(events.slice(0, 6), [
    'llm.request', 'llm.response', 'tool.started', 'tool.finished', 'llm.request', 'llm.response'
  ]);
});
