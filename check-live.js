require('dotenv').config();
const { getEarliestSlot } = require('./cal-booking');
const { SYSTEM_PROMPT } = require('./create-assistant');

async function get(url, key) {
  const response = await fetch(url, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function check(name, action) {
  try { console.log(JSON.stringify({ check: name, result: await action() })); }
  catch (error) { console.log(JSON.stringify({ check: name, error: error.cause?.code || error.message })); }
}
async function main() {
  await Promise.all([
    check('local-server', () => get('http://127.0.0.1:3000/health')),
    check('public-server', () => get(new URL('/health', process.env.SAFETY_NET_URL).href)),
    check('tunnel', async () => {
      const data = await get('http://127.0.0.1:4040/api/tunnels');
      return data.tunnels.map(t => ({ url: t.public_url, target: t.config?.addr }));
    }),
    check('vapi', async () => {
      const numbers = await get('https://api.vapi.ai/phone-number', process.env.VAPI_API_KEY);
      const assistants = await get('https://api.vapi.ai/assistant', process.env.VAPI_API_KEY);
      console.log(JSON.stringify({ check: 'assistant-candidates', result: assistants.map(a => ({ id: a.id, name: a.name, url: a.model?.url, proxyMatches: a.model?.url === process.env.SAFETY_NET_URL, promptMatches: a.model?.messages?.find(m => m.role === 'system')?.content === SYSTEM_PROMPT })) }));
      return numbers.map(n => {
        const a = assistants.find(a => a.id === n.assistantId);
        return { number: n.number, assistantId: n.assistantId, name: a?.name,
          proxyMatches: a?.model?.url === process.env.SAFETY_NET_URL,
          promptMatches: a?.model?.messages?.find(m => m.role === 'system')?.content === SYSTEM_PROMPT,
          voice: a?.voice, provider: a?.model?.provider };
      });
    }),
    check('cal-availability', async () => ({ earliestSlot: await getEarliestSlot() })),
    check('doctor-email-inbox', async () => {
      await get('https://api.agentmail.to/inboxes/oncall%40agentmail.to', process.env.AGENTMAIL_API_KEY);
      return { accessible: true };
    })
  ]);
}
main();
