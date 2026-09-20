import { useEffect, useRef } from 'react';

const LABELS = {
  'call.started': ['Call started', 'vapi'],
  status: ['Status', 'vapi'],
  speech: ['Speech', 'caller'],
  transcript: ['Transcript', 'stt'],
  'turn.received': ['Turn received by proxy', 'proxy'],
  'llm.request': ['OpenAI request', 'llm'],
  'llm.response': ['OpenAI response', 'llm'],
  'tool.started': ['Tool started', 'tools'],
  'tool.finished': ['Tool finished', 'tools'],
  'transfer.returned': ['Transfer handed to Vapi', 'tools'],
  'response.sent': ['Reply sent to Vapi', 'proxy'],
  'db.saved': ['Saved to MongoDB', 'db'],
  'db.failed': ['MongoDB write failed', 'error'],
  'db.skipped': ['MongoDB skipped', 'db'],
  'webhook.received': ['Vapi webhook', 'vapi'],
  'call.ended': ['Call ended', 'vapi'],
  'call.summary': ['End-of-call report', 'vapi'],
  error: ['Error', 'error']
};

function describe(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'call.started': return d.callerPhone ? `from ${d.callerPhone}` : '';
    case 'status': return d.status;
    case 'speech': return `${d.role} ${d.status}`;
    case 'transcript': return `${d.role} (${d.transcriptType}): “${d.text}”`;
    case 'turn.received': return `${d.messageCount} messages${d.lastUserMessage ? ` · “${d.lastUserMessage}”` : ''}`;
    case 'llm.request': return `${d.model} · ${d.messageCount} msgs · tools: ${(d.tools || []).join(', ')}`;
    case 'llm.response': return `${d.finishReason}${d.latencyMs != null ? ` · ${d.latencyMs} ms` : ''}${d.toolCalls?.length ? ` · ${d.toolCalls.join(', ')}` : ''}${d.contentPreview ? ` · “${d.contentPreview}”` : ''}`;
    case 'tool.started': return `${d.name} ${d.args ? JSON.stringify(d.args) : ''}`;
    case 'tool.finished': return `${d.name} → ${d.success ? 'ok' : 'failed'}${d.latencyMs != null ? ` · ${d.latencyMs} ms` : ''}`;
    case 'transfer.returned': return `→ ${d.destination}`;
    case 'response.sent': return `${d.stream ? 'SSE' : 'JSON'} · ${d.finishReason}`;
    case 'db.saved': return d.op;
    case 'db.failed': return `${d.op}: ${d.error}`;
    case 'db.skipped': return `${d.op} — ${d.reason}`;
    case 'webhook.received': return d.type;
    case 'call.ended':
    case 'call.summary': return `${d.reason || ''}${d.durationSeconds ? ` · ${d.durationSeconds}s` : ''}`;
    case 'error': return `${d.where}: ${d.message}`;
    default: return JSON.stringify(d);
  }
}

export default function Timeline({ events }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [events.length]);
  return (
    <section className="card timeline">
      <header className="card-head"><h2>Event timeline</h2><span className="muted">{events.length} events</span></header>
      <ol>
        {events.map((e) => {
          const [label, kind] = LABELS[e.type] || [e.type, 'other'];
          return (
            <li key={e.id} className={`ev ${kind}`}>
              <span className="ev-time">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}<small>.{String(new Date(e.ts).getMilliseconds()).padStart(3, '0')}</small></span>
              <span className={`ev-kind ${kind}`}>{label}</span>
              <span className="ev-desc">{describe(e)}</span>
            </li>
          );
        })}
        {!events.length && <li className="muted empty">Events will appear here as the call progresses.</li>}
        <li ref={endRef} />
      </ol>
    </section>
  );
}
