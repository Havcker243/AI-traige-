const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildOpenAIBody, resolveCompletion, sendCompletion } = require('../server');
const { buildAssistantPayload } = require('../create-assistant');
const { TEST_TRANSFER_NUMBER, validateTransfer } = require('../transfer-config');
const { selectRoutineSlot } = require('../cal-booking');

const transferSchema = { type: 'function', function: { name: 'transferCall', parameters: {
  type: 'object', properties: { destination: { type: 'string' } }, required: ['destination']
} } };
const call = (name, args = {}) => ({ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const transfer = call('transferCall', { destination: TEST_TRANSFER_NUMBER });
const response = calls => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: calls } }] });

test('merges only supported Vapi tools and deduplicates names', () => {
  const body = buildOpenAIBody({ messages: [], tools: [transferSchema, transferSchema,
    { type: 'function', function: { name: 'arbitrary_tool' } }] },
    [{ type: 'function', function: { name: 'save_patient_info' } }]);
  assert.deepEqual(body.tools.map(t => t.function.name), ['transferCall', 'save_patient_info']);
  assert.equal(body.parallel_tool_calls, false);
});

test('assistant has a native warm transfer with transcript summary and end-of-call webhook', () => {
  const previous = process.env.SAFETY_NET_URL;
  process.env.SAFETY_NET_URL = 'https://example.com/chat/completions';
  try {
    const payload = buildAssistantPayload();
    const tool = payload.model.tools[0];
    assert.equal(tool.type, 'transferCall');
    assert.equal(tool.destinations[0].number, TEST_TRANSFER_NUMBER);
    assert.equal(tool.destinations[0].transferPlan.mode, 'warm-transfer-experimental');
    assert.deepEqual(tool.destinations[0].transferPlan.transferAssistant.voice, payload.voice);
    assert.equal(tool.destinations[0].transferPlan.fallbackPlan.endCallEnabled, false);
    assert.match(tool.destinations[0].transferPlan.transferAssistant.model.messages[0].content, /transferSuccessful/);
    assert.match(tool.destinations[0].transferPlan.transferAssistant.model.messages[0].content, /transferCancel/);
    assert.equal(payload.server.url, 'https://example.com/vapi/webhook');
    assert.deepEqual(payload.serverMessages, ['end-of-call-report', 'status-update', 'transcript', 'speech-update']);
  } finally {
    if (previous === undefined) delete process.env.SAFETY_NET_URL;
    else process.env.SAFETY_NET_URL = previous;
  }
});

test('transfer returns to Vapi without executing it locally or calling the model again', async () => {
  let count = 0;
  const result = await resolveCompletion({ tools: [transferSchema], messages: [] }, {}, {
    callOpenAI: async () => { count++; return response([transfer]); },
    executeTool: async () => { assert.fail('Transfer must not execute locally'); }
  });
  assert.deepEqual(result.toolCalls, [transfer]);
  assert.equal(count, 1);
});

test('mixed response saves intake but never books or forwards local calls during a transfer', async () => {
  const executed = [];
  const result = await resolveCompletion({ tools: [transferSchema], messages: [] }, {}, {
    callOpenAI: async () => response([call('save_patient_info', { address: 'Test address' }), call('book_appointment'), transfer]),
    executeTool: async t => { executed.push(t.function.name); return '{}'; }
  });
  assert.deepEqual(executed, ['save_patient_info']);
  assert.deepEqual(result.toolCalls, [transfer]);
});

test('unconfigured, malformed, real-911 and arbitrary destinations cannot transfer', async () => {
  for (const destination of ['911', '+1911', '+12025550199', undefined]) {
    assert.equal(validateTransfer(call('transferCall', { destination })), false);
  }
  assert.equal(validateTransfer({ function: { arguments: '{bad' } }), false);
  for (const tools of [[], [transferSchema]]) {
    let count = 0;
    const result = await resolveCompletion({ tools, messages: [] }, {}, {
      callOpenAI: async body => {
        if (count++ === 0) return response([tools.length ? call('transferCall', { destination: '911' }) : transfer]);
        assert.match(body.messages.at(-1).content, /not allowed/);
        return { choices: [{ finish_reason: 'stop', message: { content: 'The test transfer is unavailable.' } }] };
      },
      executeTool: () => assert.fail('Must not execute invalid transfer')
    });
    assert.equal(result.toolCalls, undefined);
  }
});

test('local tool results are fed back before a later transfer', async () => {
  let count = 0;
  const result = await resolveCompletion({ tools: [transferSchema], messages: [] }, {}, {
    callOpenAI: async body => {
      if (count++ === 0) return response([call('set_disposition', { disposition: 'emergency' })]);
      assert.equal(body.messages.at(-1).role, 'tool');
      return response([transfer]);
    }, executeTool: async () => '{"success":true}'
  });
  assert.deepEqual(result.toolCalls, [transfer]);
});

test('streaming and JSON responses retain transfer ID, arguments, and finish reason', () => {
  let json;
  sendCompletion({ json: body => { json = body; } }, { content: null, toolCalls: [transfer] }, 'test-model', false);
  assert.deepEqual(json.choices[0].message.tool_calls, [transfer]);
  assert.equal(json.choices[0].finish_reason, 'tool_calls');
  let stream = '';
  sendCompletion({ setHeader() {}, write: part => { stream += part; }, end: part => { stream += part; } },
    { content: 'Connecting the test operator.', toolCalls: [transfer] }, 'test-model', true);
  const chunks = stream.split('\n\n').filter(x => x && x !== 'data: [DONE]').map(x => JSON.parse(x.slice(6)));
  assert.equal(chunks[0].choices[0].delta.tool_calls[0].index, 0);
  assert.equal(chunks[0].choices[0].delta.tool_calls[0].id, transfer.id);
  assert.equal(chunks[0].choices[0].delta.tool_calls[0].function.arguments, transfer.function.arguments);
  assert.equal(chunks[1].choices[0].finish_reason, 'tool_calls');
  assert.ok(stream.endsWith('data: [DONE]\n\n'));
});

test('routine slot selection excludes clinic-today even when API groups it under tomorrow UTC', () => {
  const now = new Date('2026-09-20T22:00:00Z');
  assert.equal(selectRoutineSlot({ '2026-09-21': [
    { start: '2026-09-21T01:00:00Z' }, // Still September 20 in New York.
    { start: '2026-09-21T15:00:00Z' },
    { start: '2026-09-21T13:00:00Z' }
  ] }, now), '2026-09-21T13:00:00Z');
  assert.throws(() => selectRoutineSlot({ today: [{ start: '2026-09-21T01:00:00Z' }] }, now), /after today/);
  assert.throws(() => selectRoutineSlot({}, now), /No available/);
});
