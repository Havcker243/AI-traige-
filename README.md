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
SAFETY_NET_URL=https://your-public-tunnel-domain
```

No quotes are needed around the values.

`SAFETY_NET_URL` must be publicly reachable by Vapi. Use the ngrok HTTPS domain
forwarding to port 3000, not localhost. The proxy serves `/chat/completions` and
`/vapi/webhook` on that domain.

## Appointment confirmation texts (AgentPhone)

The existing Cal.com booking tool now sends an appointment confirmation through
[AgentPhone's messaging API](https://docs.agentphone.ai/documentation/guides/messages)
when the caller agrees to a text and confirms their mobile number with country code.
The message contains Doctor Moyo, the booked date/time/time zone, and the fixed
office address `MIT School of Nursing, Left Wing`. It does not include the symptom
interview or medical notes.

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

## Demo transfer and current handoff

The assistant now has Vapi's native `transferCall` tool configured for a warm
transfer to **+1 (774) 486-0742**, the supplied test operator number. The destination
is intended to hear a generated introduction and short caller summary, then
accept the call before connection, using `warm-transfer-experimental`.
This is a simulated emergency handoff, not real 911 or ambulance dispatch.
Sarah announces an emergency handoff to the configured operator for serious symptom scenarios or explicit
transfer tests, without requiring repeated simulation confirmation or complete intake.
An explicitly actual emergency retains direct emergency-services guidance.
Spoken introductions do not routinely say "demo"; neither assistant may claim this
number is real 911 or that emergency services have been dispatched. The receiving
assistant reports available name, age, location, callback, concerning symptoms and
guidance, identifies missing details as unknown, and waits for human acceptance.

The proxy executes its own booking/intake/database tools and returns only the
native transfer call to Vapi, preserving tool IDs and arguments in both JSON and
SSE. Only the fixed test destination is permitted. If Vapi reports a failed
transfer and resumes the assistant, the prompt explains failure without claiming
that help was sent. Do not assume a transfer request means the destination answered.

The handoff assistant uses Sarah's Elliot voice and the previous conversation.
It calls `transferSuccessful` after a human accepts, or `transferCancel` for
rejection or automated answering. The fallback returns the caller to Sarah.
See [assistant-based warm transfers](https://docs.vapi.ai/calls/assistant-based-warm-transfer).
Actual ringing, summary audio, connection, and no-answer behavior must be tested
on the connected phone number. A test call can ring the configured operator.

To update the existing assistant after changes:

```powershell
node sync-assistant.js <assistantId>
```

This sync includes the prompt, voice, native transfer tool, and end-of-call webhook.
Restart the running `server.js` process after server changes. Use `node check-live.js`
to verify connections and deployed settings; `node check-db.js` checks Atlas without
changing records.

MongoDB is now wired through root `db.js`: conversation turns, patient details,
disposition, booking details, and Vapi end-of-call reports use `triage_calls`.
The end-of-call webhook waits for persistence before acknowledging success and
returns an error if saving fails. A new live test should verify the full report
arrives after hang-up.

Routine booking excludes today based on the appointment's date in America/New_York.
The lack of same-day appointments is a scheduling constraint, not a reason to
classify every time-sensitive complaint as a 911 emergency. Non-emergency callers
may accept or decline an offered routine visit.

Confirmation texts and returned booking details use the fixed office location
`MIT School of Nursing, Left Wing` and Doctor Moyo from `office-config.js`.
The SMS never substitutes Cal.com's location. These are user-supplied prototype
details, not an independently verified facility address.

If the local DNS resolver refuses Atlas SRV queries (`querySrv ECONNREFUSED`),
set `MONGODB_DNS_SERVERS=1.1.1.1` in `.env`. This overrides the Node process's
DNS resolver used for SRV lookups; it does not change Windows DNS settings.
Remove the setting to use system defaults. `node check-db.js` verifies connectivity.

Next: live two-phone transfer testing, SMS sender activation, dashboard/API for
reviewing stored calls, written self-care summaries, and clinical scenario review.

Verification completed: 17 mocked tests pass. The public proxy produced a valid
streaming transfer tool call through OpenAI without dialing a phone, and a
synthetic end-of-call report was saved through the public webhook to MongoDB.
The synthetic record was then removed. Run `node smoke-live.js` to repeat those
checks (uses OpenAI and briefly creates/deletes its own uniquely named test record).

For the remaining telephone test, have someone ready at +1 (774) 486-0742, then
call +1 (943) 222-9510 from a different phone. Explicitly describe the scenario as
a simulation and agree to a test handoff. Verify the destination rings, hears the
summary, accepts by saying "Yes, I can take the caller," and can speak with the caller.
Also test rejection and no-answer behavior. Real 911 is
not configured or dialed by this prototype.
