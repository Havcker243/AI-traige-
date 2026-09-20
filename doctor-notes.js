require('dotenv').config();

const AGENTMAIL_INBOX = 'oncall@agentmail.to';
const DOCTOR_EMAIL = process.env.DOCTOR_EMAIL || 'dolapoadegbesan301@gmail.com';

// Turns the call transcript into a plain-language handoff note for the doctor —
// not a diagnosis, just what the caller reported and what was decided.
function buildCaseNotes({ messages, bookingStart, callerPhone }) {
  const transcript = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? 'Caller' : 'Sarah'}: ${m.content}`)
    .join('\n');

  const whenText = bookingStart
    ? new Date(bookingStart).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'Not scheduled';

  return `New appointment booked via the AI call line.

Appointment time: ${whenText}
Caller phone: ${callerPhone || 'Not captured'}

This appointment was booked automatically based on an AI phone interview. Below is the full conversation for context before the visit — please review, this is not a diagnosis.

--- Call Transcript ---
${transcript}
--- End Transcript ---`;
}

async function sendDoctorNotes({ messages, bookingStart, callerPhone }) {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new Error('Missing AGENTMAIL_API_KEY');

  const body = {
    to: DOCTOR_EMAIL,
    subject: `New appointment booked — ${callerPhone || 'unknown caller'}`,
    text: buildCaseNotes({ messages, bookingStart, callerPhone })
  };

  const res = await fetch(`https://api.agentmail.to/inboxes/${AGENTMAIL_INBOX}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`AgentMail send failed: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = { sendDoctorNotes, buildCaseNotes };
