const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveHandoff, acceptedHandoff } = require('../handoff');
const summary = { role: 'assistant', content: 'Name: Test. Age: 45. Location: unknown. Callback: unknown. Symptoms: severe bleeding. Can you take this caller now?' };
const tools = ['transferSuccessful', 'transferCancel'].map(name => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }));
test('greetings, interruptions, refusal and patient-context acceptance cannot connect', () => {
  for (const content of ['Hello', 'Yes', 'Wait, what is their age?', 'No, do not connect them', 'yes, connect them but wait']) {
    assert.equal(acceptedHandoff([summary, { role: 'user', content }]), false);
  }
  assert.equal(acceptedHandoff([{ role: 'system', content: summary.content }, { role: 'user', content: 'Yes, connect them' }]), false);
  assert.equal(acceptedHandoff([{ role: 'assistant', content: 'Hello, emergency handoff.' }, { role: 'user', content: 'Connect them' }]), false);
});
test('full summary followed by explicit acceptance connects without model discretion', async () => {
  const result = await resolveHandoff({ tools, messages: [summary, { role: 'user', content: 'Yes, connect them.' }] }, () => assert.fail('No model needed'));
  assert.equal(result.toolCalls[0].function.name, 'transferSuccessful');
});
test('a model cannot bypass the gate and cancellation remains available', async () => {
  for (const name of ['transferSuccessful', 'transferCancel']) {
    const result = await resolveHandoff({ tools, messages: [] }, async body => {
      assert.deepEqual(body.tools.map(t => t.function.name), ['transferCancel']);
      return { choices: [{ message: { tool_calls: [{ id: 'test', type: 'function', function: { name, arguments: '{}' } }] } }] };
    });
    assert.equal(result.toolCalls?.[0]?.function.name, name === 'transferCancel' ? name : undefined);
  }
});
