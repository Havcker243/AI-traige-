# On Call

“On call. Never on hold.”

## Inspiration

Calling a doctor's office can involve long waits, and some patients give up before reaching someone. Staff cannot always handle every incoming call at once. On Call explores how a voice assistant can help collect symptoms, identify concerning situations, and guide callers toward a next step.

## What it does

A caller dials the On Call phone line and describes what is wrong. David, the voice assistant:

- Collects a structured symptom history using symptom-specific questions from a reference library.
- Screens for concerning symptoms such as chest pain, trouble breathing, severe bleeding, stroke-like symptoms, or confusion.
- Provides guidance about seeking urgent evaluation, arranging a routine appointment, or managing symptoms at home, without intentionally diagnosing.
- Books the next available routine appointment through Cal.com. The current booking flow excludes same-day appointments; it does not book urgent care.
- Gives spoken care guidance and instructions about when to seek further help.
- Stores patient information, transcripts, booking details, and call reports in MongoDB Atlas.
- Sends doctor notes and custom appointment-confirmation emails to the project's configured recipients. SMS is disabled, and confirmation emails are not yet routed to an address collected from each caller.
- Supports an experimental warm handoff to a supplied operator number. It is configured to introduce the caller, summarize available details and concerning symptoms, and connect the parties after a human accepts. It does not call real 911 or dispatch an ambulance; the complete warm-handoff experience still needs phone verification.

A React dashboard displays call activity, transcripts, case summaries, saved call history, and the system's processing steps. It also provides simulated routine and emergency scenarios for demonstrating the interface.

On Call is a prototype intended to help callers understand the suggested next step. Its clinical guidance has not been established as safe or reliable through clinician-led validation.

## How we built it

- **Vapi:** receives phone calls and coordinates the live voice conversation and transfers.
- **Deepgram:** transcribes caller speech using nova-2-general.
- **Voice:** David and the handoff assistant use Vapi Elliot. The dashboard's custom display label is "ElevenLabs".
- **OpenAI gpt-4o-mini:** interprets responses, selects follow-up questions, and generates replies and tool requests.
- **Question library:** supplies symptom-specific interview and care-guidance reference material; the conversation is not limited to six fixed questions.
- **Node.js and Express:** connect Vapi, OpenAI, booking, email, database operations, and dashboard APIs.
- **Cal.com:** supplies availability and creates routine appointments.
- **AgentMail:** sends doctor notes and custom booking-confirmation emails.
- **MongoDB Atlas:** stores patient details and call records.
- **React and Vite:** power the dashboard, with server-sent events supplying live updates.
- **ngrok:** exposes the phone backend during development and testing.
- **dotenv:** loads configuration and API credentials from environment files. It does not encrypt or independently secure those credentials.

## Individual contributions

As provided by the team:

- **Oludolapo Adegbesan:** Backend & Infrastructure
- **Kenia Ramos:** Frontend & UI/UX
- **Thy Nguyen:** Model Evaluation & Video Editing

## Challenges we ran into

The team iterated on prompts and interview structure to make conversations more natural and consistent. The initial keyword-based emergency override was disabled in favor of model-guided assessment using the question library. Integration work included filtering requests for the OpenAI API, keeping local and live assistant settings synchronized, handling booking failures, resolving database connectivity issues, and coordinating transfer behavior. SMS testing limitations led to an email-only booking-confirmation flow. The warm handoff also required a different transfer mode after the original configuration connected calls without the expected introduction.

## Accomplishments that we're proud of

We built a working phone-based symptom-interview prototype and integrated real routine appointment booking, doctor-note emails, custom confirmation emails, database persistence, and a dashboard. We also configured an experimental operator handoff and added automated tests for booking, notification failures, patient-save ordering, transfer handling, and dashboard events.

The frontend production build has passed. Full phone-to-booking-to-email and warm-transfer verification remain separate from mocked tests. The latest test run did not complete, so no current total of passing tests is claimed here.

## What we learned

Integrating services requires attention to request formats, asynchronous writes, failure handling, and consistent deployment settings. A successful API response does not prove that an email arrived or that two people were connected by phone. Scenario testing and clinician review are necessary before relying on medical guidance. The team also reports learning to use Devin by Cognition after the demo and to combine different APIs into a coordinated workflow.

## What's next

Our immediate priorities are verifying complete booking/email and operator-handoff journeys and reviewing clinical scenarios with qualified professionals. The current dashboard is deliberately a bare-bones local interface without login. Future improvements include multilingual support and routing confirmations to each caller's verified preferred email address.

## Submission notes

- Include “built in under 24 hours” only if the team can confirm that timeline.
- The original “20–30 minutes” and caller-abandonment claims need supporting sources if you want specific statistics; the inspiration above uses general wording instead.
- The current assistant and transfer assistant use Vapi Elliot; "ElevenLabs" is a custom dashboard label.
- Spoken care guidance exists; a separate written self-care summary is not claimed.
