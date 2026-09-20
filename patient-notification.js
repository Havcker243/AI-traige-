require('dotenv').config();
const { buildConfirmation } = require('./twilio-sms');

const AGENTMAIL_INBOX = 'oncall@agentmail.to';
// The call flow never collects a real email from the caller, and Twilio SMS is
// blocked on the trial account (see twilio-sms.js) — for this demo, every booking
// confirmation is emailed here as a stand-in for "the patient's inbox."
const PATIENT_EMAIL = 'nguyenthy1325@gmail.com';

async function sendPatientConfirmationEmail(booking) {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new Error('Missing AGENTMAIL_API_KEY');

  const body = {
    to: PATIENT_EMAIL,
    subject: 'Your appointment is confirmed',
    text: buildConfirmation(booking)
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

module.exports = { sendPatientConfirmationEmail, PATIENT_EMAIL };
