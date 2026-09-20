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

// Twilio's Messages API is form-encoded, not JSON, and auth is HTTP Basic
// (Account SID as username, Auth Token as password) rather than a bearer token.
async function sendBookingConfirmation({ booking, to, consent }, {
  fetchImpl = globalThis.fetch, env = process.env
} = {}) {
  if (consent !== true) return { status: 'skipped', reason: 'No SMS permission.' };
  const recipient = normalizePhone(to);
  if (!recipient) return { status: 'skipped', reason: 'A confirmed mobile number with country code is required.' };
  const sender = normalizePhone(env.TWILIO_FROM_NUMBER);
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token } = env;
  if (!sid || !token || !sender) {
    return { status: 'unavailable', reason: 'SMS configuration is incomplete.' };
  }

  try {
    // Do not retry automatically: a timeout can happen after Twilio accepts the text.
    const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ From: sender, To: recipient, Body: buildConfirmation(booking) }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (!response.ok || !data.sid || ['failed', 'undelivered'].includes(data.status)) {
      return { status: 'failed', reason: data.message ? `Twilio: ${data.message}` : `Twilio returned HTTP ${response.status}.` };
    }
    // Twilio's initial response is always queued/accepted, never a delivery confirmation —
    // knowing actual delivery would need a status-callback webhook, which isn't wired up.
    return {
      status: data.status === 'delivered' ? 'delivered' : 'submitted',
      messageId: data.sid,
      channel: 'sms'
    };
  } catch {
    return { status: 'unknown', reason: 'Could not confirm SMS submission. Do not promise delivery or automatically resend.' };
  }
}

module.exports = { normalizePhone, buildConfirmation, sendBookingConfirmation };
