# AI triage phone loop

This project is a minimal Vapi + Deepgram + ElevenLabs + OpenAI starter for a phone-based after-hours triage assistant.

## What this demo is

This is not a diagnosis engine. It is a real-time triage line that asks a short symptom interview and routes the caller toward one of three outcomes:

- urgent/emergency care now
- same-day clinical evaluation
- home care with safe follow-up

The assistant follows the safety boundary that matters most: it never tells the caller what disease they have. It only classifies urgency and helps route them appropriately.

## 1) Create the required accounts and keys

Create or log in to:

- vapi.ai
- deepgram.com
- elevenlabs.io
- platform.openai.com

Then copy an API key from each service and place them in the `.env` file in this folder.

## 2) Install dependencies

```bash
npm install
```

## 3) Create the assistant

```bash
node create-assistant.js
```

This prints the created assistant ID.

## 4) Attach a claimed Vapi number to the assistant

```bash
node attach-number.js <phoneNumberId> <assistantId>
```

Example:

```bash
node attach-number.js phone_number_id_here assistant_id_here
```

## 5) Call your number

In Vapi, claim or buy a free number in the dashboard, then attach it to the assistant. Once the number is bound, call it and you should hear the triage greeting and be able to speak back and forth.

## 6) Replace the placeholder prompt with the real triage logic

After the loop works, swap the system prompt in `create-assistant.js` for the fuller clinical workflow your team wants. That prompt is the integration point for the rest of the project.

## `.env` template

```env
VAPI_API_KEY=
DEEPGRAM_API_KEY=
ELEVENLABS_API_KEY=
OPENAI_API_KEY=
```

No quotes are needed around the values.
