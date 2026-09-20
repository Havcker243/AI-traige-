require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { EMERGENCY_MESSAGE, checkMessagesForRedFlags } = require('./red-flags');
const { createBooking } = require('./cal-booking');
const { sendDoctorNotes } = require('./doctor-notes');
// SMS is disabled; confirmations are sent through patient-notification.
const { sendPatientConfirmationEmail } = require('./patient-notification');
const { upsertTranscript, savePatientInfo, recordBooking, recordDisposition, recordEndOfCallReport, getPatientInfo } = require('./db');
const { validateTransfer } = require('./transfer-config');

const BOOKING_INSTRUCTIONS = {
  role: 'system',
  content: 'Booking update: SMS is disabled. Do not offer texts, ask for texting permission, or collect an SMS number. After the caller agrees to book, call book_appointment with callerName. Read the confirmed date, time, time zone and location aloud. A custom confirmation email goes to the configured project inbox, not a caller-provided address; do not promise email delivery to the caller. Never rebook to retry a notification.'
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
    description: "Books the next available routine appointment after today. Never a same-day visit or emergency service. Only call after explicit agreement to book and collection of the caller's name.",
    parameters: {
      type: 'object',
      properties: {
        callerName: { type: 'string', description: "The caller's name, as given during the call." }
      },
      required: ['callerName']
    }
  }
};

const SAVE_PATIENT_INFO_TOOL = {
  type: 'function',
  function: {
    name: 'save_patient_info',
    description: "Saves caller details you've collected so far (name, age, sex assigned at birth, phone number, address) to the case record. Call this as soon as you learn any of these, even partially — during the normal intake (step 5) and always during an emergency (step 4A) once you have the address/callback number. Safe to call multiple times as you learn more; only pass the fields you actually have.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The caller's name." },
        age: { type: 'string', description: "The caller's age, as given." },
        sex: { type: 'string', description: "Sex assigned at birth, only if you actually asked (per step 5, only when relevant to the symptom)." },
        phone: { type: 'string', description: 'A callback or contact number the caller gave, including country code if known. Save whatever they say even if unconfirmed for SMS purposes.' },
        address: { type: 'string', description: "The caller's current street address, including apartment/unit if given." }
      }
    }
  }
};

const SET_DISPOSITION_TOOL = {
  type: 'function',
  function: {
    name: 'set_disposition',
    description: "Records the triage outcome for this call. Call this once you reach step 4A (emergency) or step 9 (disposition) — as soon as you know the classification, not at the end of the call. Safe to call again if the classification changes as the conversation continues.",
    parameters: {
      type: 'object',
      properties: {
        disposition: {
          type: 'string',
          enum: ['emergency', 'routine'],
          description: "emergency = step 4A triggered by a red flag. routine = everything else (booking is offered regardless of how mild)."
        },
        chiefComplaint: { type: 'string', description: "A short (5-10 word) summary of the main symptom/reason for the call, e.g. 'sudden severe headache' or 'ankle sprain after fall'." }
      },
      required: ['disposition']
    }
  }
};

const LOCAL_TOOL_NAMES = new Set(['book_appointment', 'save_patient_info', 'set_disposition']);

// Execute local tools here; return the configured transfer tool to Vapi.
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

  // Vapi injects its own native tools (e.g. transferCall, configured on the assistant
  // itself) into the incoming request's `tools` field — those must be preserved and
  // passed straight through, alongside the tools we add ourselves, or a native tool
  // call would silently vanish from the model's options.
  const incomingTools = Array.isArray(reqBody.tools)
    ? reqBody.tools.filter(t => t.type === 'function' && t.function?.name === 'transferCall') : [];
  const combinedTools = [...incomingTools, ...(extraTools || [])];
  if (combinedTools.length) {
    body.tools = [...new Map(combinedTools.map(t => [t.function.name, t])).values()];
    body.parallel_tool_calls = false;
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

async function executeTool(toolCall, context, dependencies = {}) {
  const deps = {
    createBooking, sendDoctorNotes, sendPatientConfirmationEmail,
    savePatientInfo, recordBooking, recordDisposition, getPatientInfo,
    ...dependencies
  };
  let args;
  try { args = JSON.parse(toolCall.function.arguments || '{}'); }
  catch { return JSON.stringify({ success: false, error: 'Invalid tool arguments; supply a JSON object.' }); }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return JSON.stringify({ success: false, error: 'Tool arguments must be an object.' });
  }

  if (toolCall.function.name === 'save_patient_info') {
    try {
      const saved = await deps.savePatientInfo(context.callId, {
        name: args.name, age: args.age, sex: args.sex, phone: args.phone, address: args.address
      });
      if (saved === false) return JSON.stringify({ success: false, error: 'Patient information could not be stored.' });
      return JSON.stringify({ success: true });
    } catch (err) {
      console.error('[db] save_patient_info failed:', err.message);
      return JSON.stringify({ success: false, error: 'Patient information could not be stored. Do not claim it was saved.' });
    }
  }

  if (toolCall.function.name === 'set_disposition') {
    if (!['emergency', 'routine'].includes(args.disposition)) {
      return JSON.stringify({ success: false, error: 'Disposition must be emergency or routine.' });
    }
    deps.recordDisposition(context.callId, {
      disposition: args.disposition,
      chiefComplaint: args.chiefComplaint,
      redFlag: args.disposition === 'emergency'
    }).catch((err) => console.error('[db] set_disposition failed:', err.message));
    return JSON.stringify({ success: true });
  }

  if (toolCall.function.name === 'book_appointment') {
    try {
      const booking = await deps.createBooking({ name: args.callerName, phone: context.callerPhone });
      Promise.resolve()
        .then(() => deps.getPatientInfo(context.callId))
        .catch(() => ({}))
        .then((patient) => deps.sendDoctorNotes({
          messages: context.messages,
          bookingStart: booking.start,
          callerPhone: context.callerPhone,
          patient
        }))
        .catch((err) => console.error('[doctor-notes] send failed:', err.message));
      deps.recordBooking(context.callId, booking).catch((err) => console.error('[db] recordBooking failed:', err.message));
      deps.sendPatientConfirmationEmail(booking).catch((err) => console.error('[patient-notification] send failed:', err.message));

      return JSON.stringify({
        success: true,
        appointmentTime: booking.start,
        timeZone: booking.timeZone,
        location: booking.location,
        doctorName: booking.doctorName,
        note: 'Booking confirmed. Read the date, time, time zone and location aloud. Email notifications are processed separately; do not claim caller delivery or rebook to retry a notification.'
      });
    } catch (err) {
      console.error('[book_appointment] failed:', err.message);
      return JSON.stringify({ success: false, error: 'Booking could not be confirmed. Ask the caller to contact the office; do not promise an automatic callback.' });
    }
  }

  return JSON.stringify({ success: false, error: 'Unknown tool' });
}

// Resolves a conversation turn to final assistant text, executing any tool
// calls (currently just book_appointment) along the way. Always non-streaming
// internally — the caller (our route handler) decides how to relay the result.
async function resolveCompletion(openaiBody, context, dependencies = {}) {
  const complete = dependencies.callOpenAI || callOpenAI;
  const execute = dependencies.executeTool || executeTool;
  let body = openaiBody;

  for (let i = 0; i < 3; i++) {
    const data = await complete(body);
    const choice = data.choices[0];

    if (choice.finish_reason !== 'tool_calls') {
      return { content: choice.message.content, raw: data };
    }

    const calls = choice.message.tool_calls || [];
    const transfer = calls.find(t => t.function?.name === 'transferCall');
    const transferOffered = body.tools?.some(t => t.function?.name === 'transferCall');
    if (transfer && transferOffered && validateTransfer(transfer)) {
      // Persist any intake tools in a mixed response, but never book while transferring.
      for (const call of calls) {
        if (['save_patient_info', 'set_disposition'].includes(call.function?.name)) {
          await execute(call, context);
        }
      }
      return { content: choice.message.content || null, toolCalls: [transfer] };
    }

    const toolMessages = [];
    for (const toolCall of choice.message.tool_calls) {
      const result = LOCAL_TOOL_NAMES.has(toolCall.function?.name)
        ? await execute(toolCall, context)
        : JSON.stringify({ success: false, error: 'Transfer unavailable or destination not allowed. Do not claim connection. For a real emergency, tell the caller to dial 911 directly.' });
      toolMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
    }

    body = {
      ...body,
      messages: [...body.messages, choice.message, ...toolMessages]
    };
  }

  return { content: "I'm having trouble completing that — let's try something else." };
}

function sendCompletion(res, { content, toolCalls }, model, stream) {
  const id = `chatcmpl-${Date.now()}`;
  const finishReason = toolCalls?.length ? 'tool_calls' : 'stop';
  if (!stream) {
    return res.json({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: content ?? null,
        ...(toolCalls?.length ? { tool_calls: toolCalls } : {}) }, finish_reason: finishReason }] });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const chunk = chatCompletionChunk({ id, model, content: content || '' });
  chunk.choices[0].delta.role = 'assistant';
  if (toolCalls?.length) {
    chunk.choices[0].delta.tool_calls = toolCalls.map((call, index) => ({ ...call, index }));
  }
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write(`data: ${JSON.stringify(chatCompletionChunk({ id, model, finishReason }))}\n\n`);
  res.end('data: [DONE]\n\n');
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
  const callId = req.body.call?.id;
  const openaiBody = buildOpenAIBody(req.body, [BOOK_APPOINTMENT_TOOL, SAVE_PATIENT_INFO_TOOL, SET_DISPOSITION_TOOL]);

  try {
    const completion = await resolveCompletion(openaiBody, { messages, callerPhone, callId });
    const { content } = completion;

    if (callId) {
      upsertTranscript(callId, content ? [...messages, { role: 'assistant', content }] : messages, callerPhone)
        .catch((err) => console.error('[db] upsertTranscript failed:', err.message));
    }

    sendCompletion(res, completion, model, stream);
  } catch (error) {
    console.error('Error resolving completion:', error);
    if (stream) return sendForcedResponseStream(res, model);
    res.status(500).json({ error: 'Upstream request failed' });
  }
});

app.post('/vapi/webhook', async (req, res) => {
  const message = req.body.message;
  const callId = message?.call?.id;
  if (callId && message?.type === 'end-of-call-report') {
    try { await recordEndOfCallReport(callId, message); }
    catch {
      console.error('[db] end-of-call report could not be saved');
      return res.status(503).json({ received: false });
    }
  }

  res.status(200).json({
    received: true
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

if (require.main === module) app.listen(PORT, () => {
  console.log(`Triage safety-net server listening on port ${PORT}`);
});

module.exports = { app, executeTool, buildOpenAIBody, resolveCompletion, sendCompletion };
