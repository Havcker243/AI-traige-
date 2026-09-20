const DEFAULT_FROM_NUMBER = '+13142540585';
const { DOCTOR_NAME, OFFICE_LOCATION } = require('./office-config');

function normalizePhone(value) {
  if (typeof value !== 'string') return null;
  const phone = value.replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

function buildConfirmation(booking) {
  const timeZone = booking.timeZone || 'America/New_York';
  const when = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full', timeStyle: 'short', timeZone
  }).format(new Date(booking.start));
  const lines = [`Your appointment with ${DOCTOR_NAME} is confirmed for ${when} (${timeZone}).`];
  lines.push(`Location: ${OFFICE_LOCATION}`);
  return lines.join('\n');
}

async function sendBookingConfirmation({ booking, to, consent }, {
  fetchImpl = globalThis.fetch, env = process.env
} = {}) {
  if (consent !== true) return { status: 'skipped', reason: 'No SMS permission.' };
  const recipient = normalizePhone(to);
  if (!recipient) return { status: 'skipped', reason: 'A confirmed mobile number with country code is required.' };
  const sender = normalizePhone(env.AGENTPHONE_FROM_NUMBER || DEFAULT_FROM_NUMBER);
  if (!env.AGENTPHONE_API_KEY || !sender) {
    return { status: 'unavailable', reason: 'SMS configuration is incomplete.' };
  }

  try {
    // Do not retry automatically: a timeout can happen after the provider accepts a text.
    const response = await fetchImpl('https://api.agentphone.ai/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AGENTPHONE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from_number: sender, to_number: recipient, body: buildConfirmation(booking) }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return { status: 'failed', reason: `SMS provider returned HTTP ${response.status}.` };
    const data = await response.json();
    if (!data.id || ['failed', 'undelivered', 'rejected', 'canceled', 'cancelled'].includes(data.status)) {
      return { status: 'failed', reason: 'SMS provider did not accept the message.' };
    }
    return {
      status: data.status === 'delivered' ? 'delivered' : 'submitted',
      messageId: data.id,
      channel: data.channel
    };
  } catch {
    return { status: 'unknown', reason: 'Could not confirm SMS submission. Do not promise delivery or automatically resend.' };
  }
}

module.exports = { normalizePhone, buildConfirmation, sendBookingConfirmation };
