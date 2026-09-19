require('dotenv').config();

const parseArgs = () => {
  const [phoneNumberId, assistantId] = process.argv.slice(2);

  if (!phoneNumberId || !assistantId) {
    console.error('Usage: node attach-number.js <phoneNumberId> <assistantId>');
    process.exit(1);
  }

  return { phoneNumberId, assistantId };
};

const attachAssistant = async ({ phoneNumberId, assistantId }) => {
  if (!process.env.VAPI_API_KEY) {
    throw new Error('Missing VAPI_API_KEY in your .env file.');
  }

  const url = `https://api.vapi.ai/phone-number/${phoneNumberId}`;
  const body = { assistantId };

  const methods = ['PATCH', 'PUT'];

  for (const method of methods) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let payload;

    try {
      payload = text ? JSON.parse(text) : {};
    } catch (error) {
      payload = { raw: text };
    }

    if (response.ok) {
      console.log(`Phone number ${phoneNumberId} attached to assistant ${assistantId}`);
      if (payload?.id || payload?.assistantId) {
        console.log(JSON.stringify(payload, null, 2));
      }
      return;
    }

    if (response.status === 404 && method === 'PATCH') {
      continue;
    }

    const message = payload?.error || payload?.message || text || 'Unknown error';
    throw new Error(`Failed to attach phone number (${response.status}): ${message}`);
  }

  throw new Error('Could not update the phone number with the assistant assignment.');
};

(async () => {
  try {
    const args = parseArgs();
    await attachAssistant(args);
  } catch (error) {
    console.error('Error attaching number to assistant:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
