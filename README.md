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

## 3) Start the local safety-net server

This project includes a local proxy that forwards calls to OpenAI and adds the emergency red-flag safety layer.

```bash
npm start
```

The local endpoint is exposed at:

```text
http://localhost:3000/chat/completions
```

## 4) Create the assistant

```bash
node create-assistant.js
```

This prints the created assistant ID. It expects `SAFETY_NET_URL` in your `.env` file to point to the local proxy above.

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
SAFETY_NET_URL=http://localhost:3000/chat/completions
```

No quotes are needed around the values.

<<<<<<< Updated upstream
## Appointment confirmation texts (AgentPhone)

The existing Cal.com booking tool now sends an appointment confirmation through
[AgentPhone's messaging API](https://docs.agentphone.ai/documentation/guides/messages)
when the caller agrees to a text and confirms their mobile number with country code.
The message contains the booked date, time, time zone, and location when Cal.com
returns one. It does not include the symptom interview or medical notes.

Add these settings to your local `.env` (never commit API keys):

```env
AGENTPHONE_API_KEY=your_agentphone_key
AGENTPHONE_FROM_NUMBER=+13142540585
```

The sender must belong to the AgentPhone account and be enabled for outbound
messaging. US outbound SMS requires the registration described in AgentPhone's
documentation. `AGENTCALL_API_KEY` is not used: AgentCall is a different provider.

Restart the proxy with `npm start` after configuration or code changes. The proxy
injects the updated booking instructions on every request, including for existing
Vapi assistants; there is no need to create another assistant for this change.

Texting failure does not undo an appointment. Sarah receives the SMS outcome and
must distinguish submission from confirmed delivery. Sends are not automatically
retried after timeouts because the provider may already have accepted the text.
This integration sends a confirmation for an appointment already booked; it does
not implement inbound text replies or booking through SMS.

Run `npm test` for mocked tests; these do not create appointments, send emails,
or send real messages. Live SMS delivery still needs a real-device test.
=======
`SAFETY_NET_URL` is the endpoint that Vapi calls for the voice assistant model. In local development, it should point to the safety-net server running in this repo.
>>>>>>> Stashed changes
