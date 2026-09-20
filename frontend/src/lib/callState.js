export const STAGES = [
  { id: 'caller', label: 'Caller', sub: 'Phone line' },
  { id: 'vapi', label: 'Vapi', sub: 'Telephony + orchestration' },
  { id: 'stt', label: 'Speech-to-text', sub: 'Deepgram' },
  { id: 'proxy', label: 'Safety-net proxy', sub: 'server.js' },
  { id: 'llm', label: 'OpenAI', sub: 'gpt-4o-mini triage' },
  { id: 'tools', label: 'Tools', sub: 'Intake · Disposition · Booking' },
  { id: 'tts', label: 'Voice', sub: 'Text-to-speech' }
];

export const TOOL_STAGES = [
  { id: 'save_patient_info', label: 'save_patient_info', sub: 'MongoDB' },
  { id: 'set_disposition', label: 'set_disposition', sub: 'MongoDB' },
  { id: 'book_appointment', label: 'book_appointment', sub: 'Cal.com · AgentMail' },
  { id: 'transferCall', label: 'transferCall', sub: 'Vapi warm transfer' }
];

export function emptyCall(callId) {
  return {
    callId,
    callerPhone: null,
    startedAt: null,
    endedAt: null,
    status: 'active',
    activeStage: 'vapi',
    activeTool: null,
    speaking: null,
    partialTranscript: null,
    transcript: [],
    patient: {},
    disposition: null,
    chiefComplaint: null,
    booking: null,
    sms: null,
    transfer: null,
    llmCalls: [],
    tools: [],
    db: [],
    errors: [],
    endReason: null,
    summary: null,
    turns: 0,
    events: []
  };
}

const KEY_NO_CALL = '__no_call__';

function pushTranscript(call, line) {
  const last = call.transcript[call.transcript.length - 1];
  if (last && last.role === line.role && line.text && last.text) {
    const a = last.text.slice(0, 30).toLowerCase();
    const b = line.text.slice(0, 30).toLowerCase();
    if (a === b) {
      call.transcript[call.transcript.length - 1] = { ...last, ...line };
      return;
    }
  }
  call.transcript.push(line);
}

export function applyEvent(calls, event) {
  const key = event.callId || KEY_NO_CALL;
  const prev = calls[key];
  const call = prev ? { ...prev, transcript: [...prev.transcript], llmCalls: [...prev.llmCalls], tools: [...prev.tools], db: [...prev.db], errors: [...prev.errors], events: [...prev.events], patient: { ...prev.patient } } : emptyCall(event.callId);
  const d = event.data || {};
  call.events.push(event);
  if (!call.startedAt) call.startedAt = event.ts;
  call.lastEventAt = event.ts;

  switch (event.type) {
    case 'call.started':
      call.startedAt = event.ts;
      if (d.callerPhone) call.callerPhone = d.callerPhone;
      call.activeStage = 'vapi';
      break;
    case 'status':
      if (d.status === 'ended') call.status = 'ended';
      break;
    case 'speech':
      if (d.status === 'started') {
        call.speaking = d.role;
        call.activeStage = d.role === 'user' ? 'caller' : 'tts';
      } else if (call.speaking === d.role) {
        call.speaking = null;
        if (d.role === 'user') call.activeStage = 'stt';
      }
      break;
    case 'transcript':
      if (d.transcriptType === 'partial') {
        call.partialTranscript = { role: d.role, text: d.text };
        call.activeStage = 'stt';
      } else {
        call.partialTranscript = null;
        pushTranscript(call, { role: d.role, text: d.text, ts: event.ts, source: 'transcript' });
        call.activeStage = d.role === 'user' ? 'stt' : 'tts';
      }
      break;
    case 'turn.received':
      call.turns += 1;
      call.activeStage = 'proxy';
      break;
    case 'llm.request':
      call.activeStage = 'llm';
      call.llmCalls.push({ ts: event.ts, model: d.model, messageCount: d.messageCount, tools: d.tools, pending: true });
      break;
    case 'llm.response': {
      call.activeStage = d.finishReason === 'tool_calls' ? 'tools' : 'proxy';
      const idx = call.llmCalls.findIndex((c) => c.pending);
      const done = { ...(idx >= 0 ? call.llmCalls[idx] : { ts: event.ts }), pending: false, finishReason: d.finishReason, toolCalls: d.toolCalls || [], latencyMs: d.latencyMs, contentPreview: d.contentPreview };
      if (idx >= 0) call.llmCalls[idx] = done; else call.llmCalls.push(done);
      if (d.finishReason !== 'tool_calls' && d.contentPreview) {
        pushTranscript(call, { role: 'assistant', text: d.contentPreview, ts: event.ts, source: 'llm' });
      }
      break;
    }
    case 'tool.started':
      call.activeStage = 'tools';
      call.activeTool = d.name;
      call.tools.push({ ts: event.ts, name: d.name, args: d.args, pending: true });
      if (d.name === 'save_patient_info' && d.args && typeof d.args === 'object') {
        for (const k of ['name', 'age', 'sex', 'phone', 'address']) if (d.args[k]) call.patient[k] = d.args[k];
      }
      break;
    case 'tool.finished': {
      const idx = call.tools.findIndex((t) => t.pending && t.name === d.name);
      const done = { ...(idx >= 0 ? call.tools[idx] : { ts: event.ts, name: d.name }), pending: false, success: d.success, result: d.result, latencyMs: d.latencyMs };
      if (idx >= 0) call.tools[idx] = done; else call.tools.push(done);
      call.activeTool = null;
      if (d.name === 'set_disposition' && d.success && done.args) {
        call.disposition = done.args.disposition || call.disposition;
        call.chiefComplaint = done.args.chiefComplaint || call.chiefComplaint;
      }
      if (d.name === 'book_appointment' && d.result) {
        if (d.success) {
          call.booking = { appointmentTime: d.result.appointmentTime, timeZone: d.result.timeZone, location: d.result.location, doctorName: d.result.doctorName };
          call.sms = d.result.sms || null;
        } else {
          call.booking = { failed: true, error: d.result.error };
        }
      }
      break;
    }
    case 'transfer.returned':
      call.activeStage = 'tools';
      call.activeTool = 'transferCall';
      call.transfer = { destination: d.destination, ts: event.ts };
      if (!call.disposition) call.disposition = 'emergency';
      break;
    case 'response.sent':
      call.activeStage = d.finishReason === 'tool_calls' ? 'vapi' : 'tts';
      break;
    case 'db.saved':
      call.db.push({ ts: event.ts, op: d.op, ok: true });
      break;
    case 'db.failed':
      call.db.push({ ts: event.ts, op: d.op, ok: false, error: d.error });
      break;
    case 'db.skipped':
      call.db.push({ ts: event.ts, op: d.op, ok: null, error: d.reason });
      break;
    case 'error':
      call.errors.push({ ts: event.ts, where: d.where, message: d.message });
      break;
    case 'call.ended':
      call.status = 'ended';
      call.endedAt = event.ts;
      call.endReason = d.reason || call.endReason;
      call.summary = d.summary || call.summary;
      call.durationSeconds = d.durationSeconds ?? call.durationSeconds;
      call.activeStage = null;
      call.activeTool = null;
      call.speaking = null;
      break;
    case 'call.summary':
      call.status = 'ended';
      call.endedAt = call.endedAt || event.ts;
      call.endReason = d.reason || call.endReason;
      call.summary = d.summary || call.summary;
      call.durationSeconds = d.durationSeconds ?? call.durationSeconds;
      call.activeStage = null;
      call.activeTool = null;
      call.speaking = null;
      break;
    default:
      break;
  }
  return { ...calls, [key]: call };
}

export function reduceEvents(calls, events) {
  let next = calls;
  for (const e of events) next = applyEvent(next, e);
  return next;
}

export function voiceProviderLabel(provider) {
  const map = { vapi: 'Vapi', '11labs': 'ElevenLabs', elevenlabs: 'ElevenLabs', openai: 'OpenAI TTS', deepgram: 'Deepgram', cartesia: 'Cartesia', playht: 'PlayHT', azure: 'Azure', rime: 'Rime' };
  return map[provider] || provider || 'Unknown';
}

export function sttProviderLabel(provider) {
  const map = { deepgram: 'Deepgram', '11labs': 'ElevenLabs', assembly: 'AssemblyAI', gladia: 'Gladia', talkscriber: 'Talkscriber', azure: 'Azure' };
  return map[provider] || provider || 'Unknown';
}
