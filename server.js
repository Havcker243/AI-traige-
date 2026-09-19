require('dotenv').config();
const express = require('express');
const { EMERGENCY_MESSAGE, checkMessagesForRedFlags } = require('./red-flags');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

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

app.post('/chat/completions', async (req, res) => {
  const { messages = [], model = 'gpt-4o-mini', stream = false } = req.body;

  const matchedFlag = checkMessagesForRedFlags(messages);

  if (matchedFlag) {
    console.log(`[red-flag] matched pattern: ${matchedFlag}`);
    if (stream) return sendForcedResponseStream(res, model);
    return sendForcedResponseJson(res, model);
  }

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...req.body, model })
    });

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
    res.status(500).json({ error: 'Upstream request failed' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Triage safety-net server listening on port ${PORT}`);
});
