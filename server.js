require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { EMERGENCY_MESSAGE, checkMessagesForRedFlags } = require('./red-flags');
const { createBooking } = require('./cal-booking');
const { sendDoctorNotes } = require('./doctor-notes');
const { sendBookingConfirmation, normalizePhone } = require('./agentphone-sms');

const BOOKING_INSTRUCTIONS = {
  role: 'system',
  content: 'Booking update: appointment confirmation texts are now supported via book_appointment. This replaces earlier statements that texting is unavailable. Before booking, ask whether the caller wants a confirmation text. If yes, collect and read back their mobile number including country code, and obtain confirmation before passing it as smsPhone with smsConsent=true. If they decline, book with smsConsent=false. Never assume caller ID is permission or a confirmed SMS number. Do not delay emergency assistance for booking or texting. After the tool returns, report the actual appointment time and time zone. Only say the text was submitted if sms.status is submitted; this does not confirm delivery. Only say delivered when sms.status is delivered. Otherwise explain the booking is confirmed but the text could not be confirmed/sent, and read the appointment details aloud. Never book again to retry a text. Do not promise an office callback unless it has actually been arranged.'
};

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const QUESTION_LIBRARY = fs.readFileSync(
  path.join(__dirname, 'triage-question-library.txt'),
  'utf8'
);

const QUESTION_LIBRARY_MESSAGE = {
  role: 'system',
  content: `Reference material below: a library of per-symptom intake questions (onset, severity scales, red-flag sub-questions, relevant history) organized by category. Use it to decide what specific things to ask about for the caller's actual symptom — pull from whichever category matches their chief complaint. Do not read these questions verbatim or in list order; rephrase them in your own natural, conversational voice per your style rules, and only ask what's relevant to this specific caller. This is a reference to draw from, not a script to recite.\n\n${QUESTION_LIBRARY}`
};

function chatCompletionChunk({ id, model, content, finishReason }) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: content !== undefined ? { content } : {},
        finish_reason: finishReason ?? null
      }
    ]
  };
}

function sendForcedResponseStream(res, model) {
  const id = `chatcmpl-redflag-${Date.now()}`;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.write(`data: ${JSON.stringify(chatCompletionChunk({ id, model, content: '' }))}\n\n`);
  res.write(`data: ${JSON.stringify(chatCompletionChunk({ id, model, content: EMERGENCY_MESSAGE }))}\n\n`);
  res.write(`data: ${JSON.stringify(chatCompletionChunk({ id, model, finishReason: 'stop' }))}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function sendForcedResponseJson(res, model) {
  res.json({
    id: `chatcmpl-redflag-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: EMERGENCY_MESSAGE },
        finish_reason: 'stop'
      }
    ]
  });
}

// Only forward fields OpenAI's API actually accepts. Vapi's request body
// also carries call/customer/assistant/metadata/timestamp context, which
// OpenAI rejects outright with a 400 if passed through.
const OPENAI_ALLOWED_FIELDS = [
  'model', 'messages', 'temperature', 'max_tokens', 'top_p',
  'frequency_penalty', 'presence_penalty', 'stop', 'n'
];

const BOOK_APPOINTMENT_TOOL = {
  type: 'function',
  function: {
    name: 'book_appointment',
    description: "Books a real same-day/routine appointment for the caller on the practice's calendar. Only call this after the caller has explicitly agreed to book, and you have their name.",
    parameters: {
      type: 'object',
      properties: {
        callerName: { type: 'string', description: "The caller's name, as given during the call." },
        smsConsent: { type: 'boolean', description: 'True only after explicit permission to send the appointment confirmation and confirmation of smsPhone.' },
        smsPhone: { type: 'string', description: 'Mobile number read back and confirmed by the caller, including + and country code. Omit if they decline SMS.' }
      },
      required: ['callerName', 'smsConsent']
    }
  }
};

// We always resolve tool calls ourselves (never forward `tools`/`stream` to
// OpenAI directly) so we can execute book_appointment and feed the result
// back in, regardless of what Vapi's own request shape asks for.
function buildOpenAIBody(reqBody, extraTools) {
  const body = {};
  for (const key of OPENAI_ALLOWED_FIELDS) {
    if (reqBody[key] !== undefined) body[key] = reqBody[key];
  }

  if (Array.isArray(body.messages)) {
    const systemEndIndex = body.messages.findIndex((m) => m.role !== 'system');
    const insertAt = systemEndIndex === -1 ? body.messages.length : systemEndIndex;
    body.messages = [
      ...body.messages.slice(0, insertAt),
      QUESTION_LIBRARY_MESSAGE,
      BOOKING_INSTRUCTIONS,
      ...body.messages.slice(insertAt)
    ];
  }

  if (extraTools && extraTools.length) {
    body.tools = extraTools;
  }

  return body;
}

async function callOpenAI(body) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText.slice(0, 500)}`);
  }

  return res.json();
}

async function executeTool(toolCall, context, dependencies = { createBooking, sendDoctorNotes, sendBookingConfirmation }) {
  const args = JSON.parse(toolCall.function.arguments || '{}');

  if (toolCall.function.name === 'book_appointment') {
    const smsPhone = normalizePhone(args.smsPhone);
    if (typeof args.smsConsent !== 'boolean' || (args.smsConsent && !smsPhone)) {
      return JSON.stringify({ success: false, error: 'Before booking, ask whether the caller wants an SMS. If yes, collect and confirm a mobile number including country code.' });
    }
    try {
      const booking = await dependencies.createBooking({ name: args.callerName, phone: smsPhone || context.callerPhone });
      Promise.resolve().then(() => dependencies.sendDoctorNotes({
        messages: context.messages,
        bookingStart: booking.start,
        callerPhone: context.callerPhone
      })).catch((err) => console.error('[doctor-notes] send failed:', err.message));

      let sms;
      try {
        sms = await dependencies.sendBookingConfirmation({ booking, to: smsPhone, consent: args.smsConsent });
      } catch {
        sms = { status: 'unknown', reason: 'SMS could not be confirmed.' };
      }

      return JSON.stringify({
        success: true,
        appointmentTime: booking.start,
        timeZone: booking.timeZone,
        location: booking.location,
        sms,
        note: 'Booking confirmed regardless of SMS status. Tell the caller the date/time and time zone. Report the SMS status accurately; do not rebook to retry SMS.'
      });
    } catch (err) {
      console.error('[book_appointment] failed:', err.message);
      return JSON.stringify({ success: false, error: 'Booking could not be confirmed. No SMS sent. Ask the caller to contact the office; do not promise an automatic callback.' });
    }
  }

  return JSON.stringify({ success: false, error: 'Unknown tool' });
}

// Resolves a conversation turn to final assistant text, executing any tool
// calls (currently just book_appointment) along the way. Always non-streaming
// internally — the caller (our route handler) decides how to relay the result.
async function resolveCompletion(openaiBody, context) {
  let body = openaiBody;

  for (let i = 0; i < 3; i++) {
    const data = await callOpenAI(body);
    const choice = data.choices[0];

    if (choice.finish_reason !== 'tool_calls') {
      return { content: choice.message.content, raw: data };
    }

    const toolMessages = [];
    for (const toolCall of choice.message.tool_calls) {
      const result = await executeTool(toolCall, context);
      toolMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
    }

    body = {
      ...body,
      messages: [...body.messages, choice.message, ...toolMessages]
    };
  }

  return { content: "I'm having trouble completing that — let's try something else." };
}

app.post('/chat/completions', async (req, res) => {
  const { messages = [], model = 'gpt-4o-mini', stream = false } = req.body;

  // Hard-coded keyword override disabled — relying on the LLM + the
  // injected question library (which includes its own red-flag/911
  // screening questions per category) to handle escalation instead.
  // const matchedFlag = checkMessagesForRedFlags(messages);
  // if (matchedFlag) {
  //   console.log(`[red-flag] matched pattern: ${matchedFlag}`);
  //   if (stream) return sendForcedResponseStream(res, model);
  //   return sendForcedResponseJson(res, model);
  // }

  const callerPhone = req.body.customer?.number || req.body.call?.customer?.number;
  const openaiBody = buildOpenAIBody(req.body, [BOOK_APPOINTMENT_TOOL]);

  try {
    const { content } = await resolveCompletion(openaiBody, { messages, callerPhone });

    if (stream) {
      const id = `chatcmpl-${Date.now()}`;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`data: ${JSON.stringify(chatCompletionChunk({ id, model, content: '' }))}\n\n`);
      res.write(`data: ${JSON.stringify(chatCompletionChunk({ id, model, content }))}\n\n`);
      res.write(`data: ${JSON.stringify(chatCompletionChunk({ id, model, finishReason: 'stop' }))}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
      });
    }
  } catch (error) {
    console.error('Error resolving completion:', error);
    if (stream) return sendForcedResponseStream(res, model);
    res.status(500).json({ error: 'Upstream request failed' });
  }
});

app.post('/vapi/webhook', async (req, res) => {
  console.log('\n📞 VAPI WEBHOOK RECEIVED');
  console.log(JSON.stringify(req.body, null, 2));

  res.status(200).json({
    received: true
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

if (require.main === module) app.listen(PORT, () => {
  console.log(`Triage safety-net server listening on port ${PORT}`);
});

module.exports = { app, executeTool, buildOpenAIBody };
