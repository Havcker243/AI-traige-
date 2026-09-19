require('dotenv').config();

const assertEnv = () => {
  const required = ['VAPI_API_KEY', 'SAFETY_NET_URL'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}. Add them to your .env file.`);
  }
};

const buildAssistantPayload = () => ({
  name: 'After Hours Nurse Triage',
  firstMessage: 'Hi, this is the after-hours nurse triage line. I can help assess whether you need urgent care now, a same-day visit, or home care. Tell me what symptom is bothering you most right now.',
  model: {
    provider: 'custom-llm',
    url: process.env.SAFETY_NET_URL,
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are an AI triage assistant for a nurse advice line. Your job is to ask a short, structured set of questions and determine urgency, not diagnose the patient. Follow these rules:\n\n1. Never diagnose. You may only triage level of urgency: urgent/emergency, same-day visit, or self-care.\n2. Prioritize emergency red flags first: chest pain, trouble breathing, severe bleeding, stroke symptoms, confusion, fainting, severe allergic reaction, suicidal thoughts, or any concern that the patient may be critically ill. If any are present, tell the caller to seek emergency care immediately and stop the routine interview.\n3. Use a brief triage script inspired by OPQRST and SAMPLE, but keep it short enough for a phone call. Ask only a few questions at a time.\n4. Ask about: main symptom, how long it has been going on, severity, onset, if there are red flags, age or pregnancy if relevant, and whether they have had similar symptoms before.\n5. Keep your responses calm, empathetic, and easy to understand. The caller may be stressed.\n6. End with a clear disposition: urgent care now, same-day appointment, or home care with self-care guidance.\n7. If the caller has a potential emergency symptoms or is immediately unstable, tell them to call 911 or seek emergency care without delay.\n8. Never provide a formal diagnosis or tell the caller they have a specific disease.\n9. If the caller says hello, greet them warmly and begin the triage questions.\n10. If they are not in immediate danger, ask one focused question at a time and move toward a disposition.\n11. If they ask about booking, offer to help schedule a visit or say they should contact their clinician.\n\nRecommended final phrasing:\n- Emergency: "This sounds urgent. Please call 911 or go to the nearest emergency department now."\n- Same-day: "This needs to be evaluated today. I can help with booking an appointment or advise you to contact your clinician now."\n- Self-care: "This sounds like something that can usually be managed at home. Here are safe home-care steps and when to seek care again."`
      }
    ],
    temperature: 0.4
  },
  transcriber: {
    provider: 'deepgram',
    model: 'nova-2-general'
  },
  voice: {
    provider: 'vapi',
    voiceId: 'Elliot'
  }
});

(async () => {
  try {
    assertEnv();

    const response = await fetch('https://api.vapi.ai/assistant', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildAssistantPayload())
    });

    const text = await response.text();
    let payload;

    try {
      payload = text ? JSON.parse(text) : {};
    } catch (error) {
      throw new Error(`Vapi returned a non-JSON response: ${text || '(empty body)'}`);
    }

    if (!response.ok) {
      const message = payload?.message || payload?.error || 'Unknown error';
      throw new Error(`Assistant creation failed (${response.status}): ${JSON.stringify(message)}`);
    }

    if (!payload.id) {
      throw new Error(`Assistant was created, but no ID was returned. Response: ${JSON.stringify(payload)}`);
    }

    console.log('Assistant created successfully!');
    console.log(`Assistant ID: ${payload.id}`);
    console.log('Next: node attach-number.js <phoneNumberId> <assistantId>');
  } catch (error) {
    console.error('Error creating Vapi assistant:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
