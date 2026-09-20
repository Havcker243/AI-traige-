import { useEffect, useMemo, useRef, useState } from 'react';
import { useEventStream } from '../hooks/useEventStream.js';
import { voiceProviderLabel, sttProviderLabel } from '../lib/callState.js';
import './map.css';

const FALLBACK_CONFIG = { voice: { provider: 'vapi', voiceId: 'Elliot' }, transcriber: { provider: 'deepgram', model: 'nova-2-general' }, model: { provider: 'custom-llm', model: 'gpt-4o-mini' }, transferNumber: '' };

const COLORS = {
  caller: '#0ea5e9', vapi: '#8b5cf6', stt: '#f59e0b', tunnel: '#64748b', proxy: '#334155', llm: '#10b981', tts: '#ec4899',
  knowledge: '#a16207', mongo: '#16a34a', cal: '#2563eb', sms: '#0d9488', mail: '#ea580c', transfer: '#dc2626'
};

// How long a link keeps "flowing" after the last piece of information crossed it.
const FLOW_MS = 2600;

// Every node: plain-English role on top, the actual technology underneath.
const W = 150; const H = 68; const GAP = 175; const ROW = [40, 240, 400];
const col = (i) => 10 + i * GAP;
const NODES = {
  caller: { x: col(0), y: ROW[0], title: 'Caller', sub: 'Phone call' },
  vapi: { x: col(1), y: ROW[0], title: 'Phone agent', sub: 'Vapi' },
  stt: { x: col(2), y: ROW[0], title: 'Speech-to-text', sub: '' },
  tunnel: { x: col(3), y: ROW[0], title: 'Secure tunnel', sub: 'ngrok' },
  proxy: { x: col(4), y: ROW[0], title: 'Triage brain', sub: 'Node.js · Express' },
  llm: { x: col(5), y: ROW[0], title: 'AI reasoning', sub: '' },
  tts: { x: col(6), y: ROW[0], title: 'Text-to-speech', sub: '' },
  transfer: { x: col(1), y: ROW[1], title: 'Live operator', sub: '' },
  knowledge: { x: col(3), y: ROW[1], title: 'Triage protocol', sub: 'question library · prompt' },
  mongo: { x: col(4), y: ROW[1], title: 'Call records', sub: 'MongoDB Atlas' },
  cal: { x: col(5), y: ROW[1], title: 'Appointments', sub: 'Cal.com' },
  sms: { x: col(6), y: ROW[1], title: 'SMS confirmation', sub: 'AgentPhone' },
  mail: { x: col(5), y: ROW[2], title: 'Doctor handoff', sub: 'AgentMail (email)' }
};
const LINKS = [
  ['caller', 'vapi'], ['vapi', 'stt'], ['stt', 'tunnel'], ['tunnel', 'proxy'], ['proxy', 'llm'], ['llm', 'tts'],
  ['knowledge', 'proxy'], ['proxy', 'mongo'], ['proxy', 'cal'], ['cal', 'sms'], ['cal', 'mail'], ['vapi', 'transfer']
];

function center(id, side) {
  const n = NODES[id];
  if (side === 'right') return [n.x + W, n.y + H / 2];
  if (side === 'left') return [n.x, n.y + H / 2];
  if (side === 'bottom') return [n.x + W / 2, n.y + H];
  return [n.x + W / 2, n.y];
}

function path(a, b) {
  const A = NODES[a]; const B = NODES[b];
  if (A.y === B.y) { const [x1, y1] = center(a, 'right'); const [x2, y2] = center(b, 'left'); return `M${x1},${y1} L${x2},${y2}`; }
  const down = A.y < B.y;
  const [x1, y1] = center(a, down ? 'bottom' : 'top'); const [x2, y2] = center(b, down ? 'top' : 'bottom');
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
}

// Which node + link is "hot" for the current call state.
function activity(call) {
  if (!call || call.status === 'ended') return { node: null, link: null };
  const last = call.events[call.events.length - 1];
  const t = last?.type; const d = last?.data || {};
  if (call.activeStage === 'tools' || t === 'tool.started') {
    const name = call.activeTool || d.name;
    if (name === 'save_patient_info' || name === 'set_disposition') return { node: 'mongo', link: 'proxy-mongo' };
    if (name === 'book_appointment') return { node: 'cal', link: 'proxy-cal' };
    if (name === 'transferCall') return { node: 'transfer', link: 'vapi-transfer' };
  }
  if (t === 'transfer.returned') return { node: 'transfer', link: 'vapi-transfer' };
  if (t?.startsWith('db.')) return { node: 'mongo', link: 'proxy-mongo' };
  const map = { caller: ['caller', 'caller-vapi'], vapi: ['vapi', 'caller-vapi'], stt: ['stt', 'vapi-stt'], proxy: ['proxy', 'tunnel-proxy'], llm: ['llm', 'proxy-llm'], tts: ['tts', 'llm-tts'] };
  const m = map[call.activeStage];
  return m ? { node: m[0], link: m[1] } : { node: null, link: null };
}

// Links that carried information for each event type.
function linksFor(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'call.started': return ['caller-vapi'];
    case 'speech': return d.role === 'user' ? ['caller-vapi', 'vapi-stt'] : ['llm-tts', 'caller-vapi'];
    case 'transcript': return d.role === 'user' ? ['vapi-stt', 'stt-tunnel'] : ['llm-tts'];
    case 'turn.received': return ['stt-tunnel', 'tunnel-proxy', 'knowledge-proxy'];
    case 'llm.request': return ['knowledge-proxy', 'proxy-llm'];
    case 'llm.response': return ['proxy-llm'];
    case 'tool.started': case 'tool.finished':
      if (d.name === 'book_appointment') return e.type === 'tool.finished' ? ['proxy-cal', 'cal-sms', 'cal-mail'] : ['proxy-cal'];
      if (d.name === 'transferCall') return ['vapi-transfer'];
      return ['proxy-mongo'];
    case 'db.saved': case 'db.failed': case 'db.skipped': return ['proxy-mongo'];
    case 'transfer.returned': return ['proxy-llm', 'vapi-transfer'];
    case 'response.sent': return ['proxy-llm', 'tunnel-proxy', 'llm-tts'];
    case 'call.ended': return ['caller-vapi'];
    default: return [];
  }
}

function flowingLinks(call, now) {
  const s = new Set();
  if (!call || call.status === 'ended') return s;
  for (let i = call.events.length - 1; i >= 0; i--) {
    const e = call.events[i];
    if (now - new Date(e.ts).getTime() > FLOW_MS) break;
    for (const l of linksFor(e)) s.add(l);
  }
  return s;
}

function visited(call) {
  const s = new Set();
  if (!call) return s;
  for (const e of call.events) {
    if (e.type === 'call.started') s.add('caller').add('vapi');
    if (e.type === 'transcript' || e.type === 'turn.received') s.add('stt').add('tunnel').add('proxy');
    if (e.type === 'llm.request') s.add('llm').add('knowledge');
    if (e.type === 'response.sent') s.add('tts');
    if (e.type === 'db.saved') s.add('mongo');
    if (e.type === 'tool.finished' && e.data?.name === 'book_appointment' && e.data?.success) s.add('cal');
    if (e.type === 'transfer.returned') s.add('transfer');
  }
  if (call.sms) s.add('sms');
  if (call.booking && !call.booking.failed) s.add('mail');
  return s;
}

function statusLine(call, labels) {
  if (!call) return 'Idle — waiting for a call';
  if (call.status === 'ended') return `Call ended · ${call.endReason || ''}`;
  const a = activity(call);
  return {
    caller: 'Caller is speaking', vapi: 'Vapi connecting the call', stt: `${labels.stt} transcribing`,
    proxy: 'Proxy preparing the turn', llm: `${labels.llm} triaging`, tts: `${labels.voice} speaking`,
    mongo: `Saving ${call.activeTool === 'set_disposition' ? 'disposition' : 'patient info'} to MongoDB`,
    cal: 'Booking appointment on Cal.com', transfer: 'Transferring to operator'
  }[a.node] || 'In progress';
}

export default function MapDesign({ onSwitch }) {
  const { calls, connected } = useEventStream();
  const [rawConfig, setRawConfig] = useState(FALLBACK_CONFIG);
  const [simulating, setSimulating] = useState(false);
  const [pinned, setPinned] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 400); return () => clearInterval(t); }, []);

  useEffect(() => { fetch('/api/config').then((r) => r.json()).then(setRawConfig).catch(() => {}); }, []);

  const labels = useMemo(() => ({
    voice: voiceProviderLabel(rawConfig.voice?.provider), voiceId: rawConfig.voice?.voiceId || '',
    stt: sttProviderLabel(rawConfig.transcriber?.provider), sttModel: rawConfig.transcriber?.model || '',
    llm: rawConfig.model?.model || 'gpt-4o-mini', transferNumber: rawConfig.transferNumber || ''
  }), [rawConfig]);

  const liveCalls = useMemo(() => Object.values(calls).sort((a, b) => new Date(b.lastEventAt) - new Date(a.lastEventAt)), [calls]);
  const auto = liveCalls.find((c) => c.status !== 'ended') || liveCalls[0] || null;
  const call = (pinned && calls[pinned]) || auto;
  const act = activity(call);
  const seen = visited(call);
  const flowing = flowingLinks(call, now);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [call?.transcript.length]);

  const simulate = async (scenario) => {
    setSimulating(true); setPinned(null);
    try { await fetch(`/api/simulate?scenario=${scenario}`, { method: 'POST' }); } catch { /* offline */ }
    setTimeout(() => setSimulating(false), 1500);
  };

  const subFor = (id) => ({
    stt: `${labels.stt}${labels.sttModel ? ` · ${labels.sttModel.replace('-general', '')}` : ''}`,
    llm: `OpenAI · ${labels.llm}`,
    tts: `${labels.voice}${labels.voiceId ? ` · ${labels.voiceId}` : ''}`,
    transfer: labels.transferNumber ? `Vapi transfer · ${labels.transferNumber}` : 'Vapi warm transfer'
  })[id] ?? NODES[id].sub;

  const p = call?.patient || {};
  const recent = call ? call.events.slice(-6).reverse() : [];

  return (
    <div className="mp">
      <header className="mp-head">
        <div className="mp-brand"><span className={`mp-dot ${connected ? 'on' : ''}`} />David · Call Flow</div>
        <div className="mp-status">{statusLine(call, labels)}</div>
        <div className="mp-actions">
          <button className="ghost" onClick={onSwitch}>Dark design</button>
          <button disabled={simulating} onClick={() => simulate('routine')}>Routine demo</button>
          <button disabled={simulating} className="danger" onClick={() => simulate('emergency')}>Emergency demo</button>
        </div>
      </header>

      <section className="mp-map">
        <svg viewBox="0 0 1220 480" preserveAspectRatio="xMidYMid meet">
          <defs>
            {[['idle', '#d9dee7'], ...Object.entries(COLORS)].map(([id, fill]) => (
              <marker key={id} id={`mp-arrow-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={fill} /></marker>
            ))}
          </defs>
          {LINKS.map(([a, b]) => {
            const id = `${a}-${b}`;
            const hot = flowing.has(id) || act.link === id;
            const done = seen.has(a) && seen.has(b);
            const d = path(a, b);
            const color = COLORS[b];
            return (
              <g key={id} className={`mp-link ${hot ? 'hot' : done ? 'done' : ''}`} style={{ color }}>
                <path d={d} markerEnd={`url(#mp-arrow-${hot || done ? b : 'idle'})`} />
                {hot && [0, 0.5].map((delay) => (
                  <circle key={delay} r="5" className="mp-packet">
                    <animateMotion dur="1s" begin={`${delay}s`} repeatCount="indefinite" path={d} />
                  </circle>
                ))}
              </g>
            );
          })}
          {Object.entries(NODES).map(([id, n]) => {
            const hot = act.node === id;
            const done = seen.has(id);
            return (
              <g key={id} className={`mp-node ${hot ? 'hot' : done ? 'done' : ''}`} style={{ color: COLORS[id] }} transform={`translate(${n.x},${n.y})`}>
                <rect className="mp-node-bar" width="6" height={H} rx="3" />
                <rect width={W} height={H} rx="12" />
                <text x={W / 2 + 3} y="28" textAnchor="middle" className="mp-node-title">{n.title}</text>
                <text x={W / 2 + 3} y="49" textAnchor="middle" className="mp-node-sub">{subFor(id)}</text>
              </g>
            );
          })}
        </svg>
      </section>

      <section className="mp-bottom">
        <div className="mp-card mp-transcript">
          <h3>Conversation {call?.speaking && <span className="mp-speaking">{call.speaking === 'user' ? 'caller speaking' : 'David speaking'}</span>}</h3>
          <div className="mp-lines">
            {(call?.transcript || []).map((l, i) => <p key={i} className={l.role}><b>{l.role === 'user' ? 'Caller' : 'David'}</b>{l.text}</p>)}
            {call?.partialTranscript && <p className={`partial ${call.partialTranscript.role}`}><b>…</b>{call.partialTranscript.text}</p>}
            {!call?.transcript.length && <p className="mp-empty">No conversation yet.</p>}
            <div ref={endRef} />
          </div>
        </div>

        <div className="mp-card">
          <h3>Outcome</h3>
          <div className={`mp-outcome ${call?.disposition || ''}`}>{call?.disposition || 'triaging'}</div>
          <p className="mp-muted">{call?.chiefComplaint || '—'}</p>
          {call?.transfer && <p className="mp-warn">Transferred to operator {call.transfer.destination}<br /><small>Test operator, not real 911.</small></p>}
          <dl>
            <dt>Name</dt><dd>{p.name || '—'}</dd>
            <dt>Age / sex</dt><dd>{[p.age, p.sex].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Callback</dt><dd>{p.phone || call?.callerPhone || '—'}</dd>
            <dt>Address</dt><dd>{p.address || '—'}</dd>
            <dt>Appointment</dt><dd>{call?.booking && !call.booking.failed ? new Date(call.booking.appointmentTime).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: call.booking.timeZone }) : '—'}</dd>
            <dt>SMS</dt><dd>{call?.sms?.status || '—'}</dd>
            <dt>Saved</dt><dd>{call?.db?.filter((d) => d.ok).map((d) => d.op).join(', ') || '—'}</dd>
          </dl>
        </div>

        <div className="mp-card">
          <h3>Last steps</h3>
          <ul className="mp-steps">
            {recent.map((e) => <li key={e.id}><span>{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>{short(e)}</li>)}
            {!recent.length && <li className="mp-empty">—</li>}
          </ul>
          <h3 className="mp-calls-h">Calls</h3>
          <ul className="mp-calls">
            {liveCalls.map((c) => <li key={c.callId || 'x'} className={c === call ? 'sel' : ''} onClick={() => setPinned(c.callId)}><span className={`mp-dot ${c.status === 'ended' ? '' : 'on'}`} />{c.patient.name || c.callerPhone || c.callId}<em className={c.disposition || ''}>{c.disposition || 'triaging'}</em></li>)}
          </ul>
        </div>
      </section>
    </div>
  );
}

function short(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'call.started': return 'Call started';
    case 'status': return `Vapi: ${d.status}`;
    case 'speech': return `${d.role === 'user' ? 'Caller' : 'David'} ${d.status === 'started' ? 'speaking' : 'stopped'}`;
    case 'transcript': return `Transcribed ${d.role}`;
    case 'turn.received': return 'Turn reached proxy';
    case 'llm.request': return `Sent to ${d.model}`;
    case 'llm.response': return d.finishReason === 'tool_calls' ? `OpenAI → ${d.toolCalls.join(', ')}` : `OpenAI replied (${d.latencyMs} ms)`;
    case 'tool.started': return `Running ${d.name}`;
    case 'tool.finished': return `${d.name} ${d.success ? 'done' : 'failed'}`;
    case 'transfer.returned': return `Transfer → ${d.destination}`;
    case 'response.sent': return 'Reply sent to Vapi';
    case 'db.saved': return `MongoDB saved ${d.op}`;
    case 'db.skipped': return `MongoDB skipped ${d.op}`;
    case 'db.failed': return `MongoDB failed ${d.op}`;
    case 'webhook.received': return `Webhook ${d.type}`;
    case 'call.ended': return 'Call ended';
    case 'error': return `Error: ${d.message}`;
    default: return e.type;
  }
}
