require('dotenv').config();

const CAL_API_BASE = 'https://api.cal.com/v2';
const EVENT_TYPE_ID = 4242047; // "30 Min Meeting" — the default event type on the account
const DEFAULT_TIMEZONE = 'America/New_York';

function calHeaders(version) {
  return {
    Authorization: `Bearer ${process.env.CAL_API_KEY}`,
    'Content-Type': 'application/json',
    'cal-api-version': version
  };
}

async function getEarliestSlot() {
  const start = new Date();
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const url = `${CAL_API_BASE}/slots?eventTypeId=${EVENT_TYPE_ID}&start=${start.toISOString().slice(0, 10)}&end=${end.toISOString().slice(0, 10)}`;

  const res = await fetch(url, { headers: calHeaders('2024-09-04') });
  if (!res.ok) throw new Error(`Failed to fetch slots: ${res.status} ${await res.text()}`);

  const data = await res.json();
  for (const day of Object.keys(data.data).sort()) {
    const slots = data.data[day];
    if (slots.length > 0) return slots[0].start;
  }
  throw new Error('No available slots in the next 7 days');
}

// Cal.com requires an attendee email even when we only have a phone number, and
// validates that the domain can actually receive mail — a fake domain gets
// rejected. We use a real, mail-receiving domain we control (via AgentMail)
// with a caller-specific subaddress, so it passes validation and any
// auto-confirmation Cal.com sends lands safely in our own inbox rather than
// implying we've emailed the caller (we haven't; that's what SMS is for).
function placeholderEmail(phone) {
  const digits = (phone || 'unknown').replace(/\D/g, '') || 'unknown';
  return `oncall+caller-${digits}@agentmail.to`;
}

async function createBooking({ name, phone }) {
  const start = await getEarliestSlot();

  const body = {
    start,
    eventTypeId: EVENT_TYPE_ID,
    attendee: {
      name: name || 'Caller',
      email: placeholderEmail(phone),
      timeZone: DEFAULT_TIMEZONE
    }
  };

  if (phone) body.metadata = { callerPhone: phone };

  const res = await fetch(`${CAL_API_BASE}/bookings`, {
    method: 'POST',
    headers: calHeaders('2026-02-25'),
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Booking failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  return {
    bookingUid: data.data?.uid,
    start,
    timeZone: DEFAULT_TIMEZONE,
    location: typeof data.data?.location === 'string' ? data.data.location : undefined,
    eventTypeId: EVENT_TYPE_ID
  };
}

module.exports = { createBooking, getEarliestSlot };
