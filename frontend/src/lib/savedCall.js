import { emptyCall } from './callState.js';

export function savedCall(record) {
  const report = record.vapiReport || {};
  const messages = report.artifact?.messages || report.messages;
  const lines = Array.isArray(messages) ? messages : (record.transcript || []);
  return {
    ...emptyCall(record.callId),
    ...record,
    status: record.status === 'completed' ? 'ended' : record.status,
    transcript: lines.filter(m => ['user', 'assistant', 'bot'].includes(m.role))
      .map(m => ({ role: m.role === 'bot' ? 'assistant' : m.role, text: m.message ?? m.content ?? '', source: 'saved' })),
    patient: record.patient || {},
    booking: record.bookingUid ? { appointmentTime: record.appointmentTime, timeZone: record.timeZone, location: record.location } : null,
    endReason: record.endedReason || report.endedReason,
    summary: record.vapiSummary || report.summary || report.analysis?.summary,
    fromHistory: true
  };
}
