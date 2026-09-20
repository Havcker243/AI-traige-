require('dotenv').config();

async function main() {
  const key = process.env.AGENTPHONE_API_KEY;
  if (!key) {
    console.error('AGENTPHONE_API_KEY is missing or empty. Use this exact uppercase name in .env.');
    process.exitCode = 1;
    return;
  }
  console.log('AGENTPHONE_API_KEY is set (value hidden).');
  const sender = process.env.AGENTPHONE_FROM_NUMBER || '+13142540585';
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const response = await fetch(`https://api.agentphone.ai/v1/numbers?offset=${offset}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      console.error(`AgentPhone account check returned HTTP ${response.status}. No SMS was sent.`);
      process.exitCode = 1;
      return;
    }
    const result = await response.json();
    const numbers = Array.isArray(result.data) ? result.data : [];
    const number = numbers.find(item => item.phoneNumber === sender);
    if (number) {
      console.log(JSON.stringify({
        authenticated: true,
        sender,
        numberFound: true,
        status: number.status,
        outboundSms: number.outboundSms,
        smsSent: false
      }, null, 2));
      return;
    }
    if (!result.hasMore || numbers.length === 0) break;
    offset += numbers.length;
  }
  console.log(JSON.stringify({ authenticated: true, sender, numberFound: false, smsSent: false }, null, 2));
  process.exitCode = 1;
}

main().catch(error => {
  console.error(`AgentPhone check could not connect (${error.cause?.code || error.name}). No SMS was sent.`);
  process.exitCode = 1;
});
