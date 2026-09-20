require('dotenv').config();
const { buildAssistantPayload } = require('./create-assistant');

async function main() {
  const id = process.argv[2];
  if (!id || !process.env.VAPI_API_KEY || !process.env.SAFETY_NET_URL) {
    throw new Error('Usage: node sync-assistant.js <assistantId>; VAPI_API_KEY and SAFETY_NET_URL must be set.');
  }
  const { model, firstMessage, voice, transcriber, server, serverMessages } = buildAssistantPayload();
  const response = await fetch(`https://api.vapi.ai/assistant/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, firstMessage, voice, transcriber, server, serverMessages }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Assistant update returned HTTP ${response.status}`);
  const result = await response.json();
  console.log(JSON.stringify({ updated: result.id, url: result.model?.url, voice: result.voice }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
