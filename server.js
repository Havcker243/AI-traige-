require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { EMERGENCY_MESSAGE, checkMessagesForRedFlags } = require('./red-flags');

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
  'model', 'messages', 'stream', 'temperature', 'max_tokens', 'top_p',
  'frequency_penalty', 'presence_penalty', 'stop', 'n', 'tools', 'tool_choice'
];

function buildOpenAIBody(reqBody) {
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
      ...body.messages.slice(insertAt)
    ];
  }

  return body;
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

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildOpenAIBody(req.body))
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error(`[openai error] status ${upstream.status}:`, errText.slice(0, 500));
      if (stream) return sendForcedResponseStream(res, model);
      return res.status(upstream.status).send(errText);
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
      res.end();
    } else {
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    }
  } catch (error) {
    console.error('Error proxying to OpenAI:', error);
    if (stream) return sendForcedResponseStream(res, model);
    res.status(500).json({ error: 'Upstream request failed' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Triage safety-net server listening on port ${PORT}`);
});
