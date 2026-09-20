// Synthetic checks only: no telephone call, appointment, SMS, or email is created.
require('dotenv').config();
const { randomUUID } = require('node:crypto');
const { MongoClient } = require('mongodb');
const { TEST_TRANSFER_NUMBER } = require('./transfer-config');
if (process.env.MONGODB_DNS_SERVERS) {
  require('node:dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(s => s.trim()));
}

async function post(path, body) {
  const response = await fetch(new URL(path, process.env.SAFETY_NET_URL), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${path}`);
  return response;
}

async function main() {
  const response = await post('/chat/completions', {
    model: 'gpt-4o-mini', stream: true, temperature: 0,
    messages: [
      { role: 'system', content: `This is a synthetic integration test, not a real emergency. The user has agreed to transfer to the test operator. Call transferCall exactly once with destination ${TEST_TRANSFER_NUMBER}. Do not call booking or persistence tools.` },
      { role: 'user', content: 'I consent to this simulated test transfer. Invoke the transfer tool now.' }
    ],
    tools: [{ type: 'function', function: {
      name: 'transferCall', description: 'Transfer the simulated call to the configured test operator.',
      parameters: { type: 'object', properties: { destination: { type: 'string', enum: [TEST_TRANSFER_NUMBER] } }, required: ['destination'] }
    } }]
  });
  const stream = await response.text();
  const chunks = stream.split('\n\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  const tool = chunks.flatMap(c => c.choices?.[0]?.delta?.tool_calls || [])[0];
  if (tool?.function?.name !== 'transferCall' || JSON.parse(tool.function.arguments).destination !== TEST_TRANSFER_NUMBER ||
      !chunks.some(c => c.choices?.[0]?.finish_reason === 'tool_calls')) throw new Error('Live transfer response did not match expectations');
  console.log('Public proxy + OpenAI returned a valid streaming test-transfer tool call. No phone was dialed.');

  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const callId = `smoke-test-${randomUUID()}`;
  try {
    await client.connect();
    const calls = client.db(process.env.MONGODB_DB || 'agent-triage').collection('triage_calls');
    try {
      await post('/vapi/webhook', { message: {
        type: 'end-of-call-report', call: { id: callId },
        endedReason: 'synthetic-test', durationSeconds: 0,
        summary: 'Synthetic persistence check; no real caller.'
      } });
      const record = await calls.findOne({ callId });
      if (record?.status !== 'completed' || record?.vapiReport?.endedReason !== 'synthetic-test') {
        throw new Error('End-of-call report was not persisted');
      }
      console.log('Public end-of-call webhook saved its synthetic report to MongoDB.');
    } finally {
      await calls.deleteOne({ callId, 'vapiReport.endedReason': 'synthetic-test' });
      console.log('Removed only this check\'s synthetic database record.');
    }
  } finally { await client.close(); }
}
main().catch(error => {
  console.error(`Live smoke check failed: ${error.code || error.name}: ${error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/g, '[database URI redacted]')}`);
  process.exitCode = 1;
});
