import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEventStream } from '../hooks/useEventStream.js';
import { voiceProviderLabel, sttProviderLabel } from '../lib/callState.js';
import './map.css';

const FALLBACK_CONFIG = { voice: { provider: 'vapi', voiceId: 'Elliot' }, transcriber: { provider: 'deepgram', model: 'nova-2-general' }, model: { provider: 'custom-llm', model: 'gpt-4o-mini' }, transferNumber: '' };

const COLORS = {
  caller: '#5aa9e6', vapi: '#9b7bea', stt: '#e8a94b', tunnel: '#8a97ab', proxy: '#4b5a75', llm: '#3fbf96', tts: '#e77aa8',
  knowledge: '#c19a3d', mongo: '#4fae6a', cal: '#5b7fe6', sms: '#3aa8a0', mail: '#ef8f5b', transfer: '#e46a6a'
};

const PULSE_MS = 800;   // travel time along a wire
const FADE_MS = 1400;   // glow fade after landing
const WIRE_HOT_MS = PULSE_MS + FADE_MS;

// Bubble layout. Role in plain words on top, technology underneath.
const R = 55; const GAP = 178; const ROW = [90, 310, 490];
const col = (i) => 70 + i * GAP;
const NODES = {
  caller: { x: col(0), y: ROW[0], title: 'Caller', sub: 'Phone call' },
  vapi: { x: col(1), y: ROW[0], title: 'Phone agent', sub: 'Vapi' },
  stt: { x: col(2), y: ROW[0], title: 'Speech-to-text', sub: '' },
  tunnel: { x: col(3), y: ROW[0], title: 'Secure tunnel', sub: 'ngrok' },
  proxy: { x: col(4), y: ROW[0], title: 'Triage brain', sub: 'Node.js · Express' },
  llm: { x: col(5), y: ROW[0], title: 'AI reasoning', sub: '' },
  tts: { x: col(6), y: ROW[0], title: 'Text-to-speech', sub: '' },
  transfer: { x: col(1), y: ROW[1], title: 'Live operator', sub: '' },
  knowledge: { x: col(3), y: ROW[1], title: 'Triage protocol', sub: 'Question library' },
  mongo: { x: col(4), y: ROW[1], title: 'Call records', sub: 'MongoDB Atlas' },
  cal: { x: col(5), y: ROW[1], title: 'Appointments', sub: 'Cal.com' },
  sms: { x: col(6), y: ROW[1], title: 'Text message', sub: 'AgentPhone' },
  mail: { x: col(5), y: ROW[2], title: 'Doctor email', sub: 'AgentMail' }
};
const WIRES = [
  ['caller', 'vapi'], ['vapi', 'stt'], ['stt', 'tunnel'], ['tunnel', 'proxy'], ['proxy', 'llm'], ['llm', 'tts'],
  ['knowledge', 'proxy'], ['proxy', 'mongo'], ['proxy', 'cal'], ['cal', 'sms'], ['cal', 'mail'], ['vapi', 'transfer']
];
const wireId = (a, b) => (WIRES.some(([x, y]) => x === a && y === b) ? `${a}-${b}` : `${b}-${a}`);

// Curved wire from the edge of bubble a to the edge of bubble b.
function wirePath(a, b) {
  const A = NODES[a]; const B = NODES[b];
  if (A.y === B.y) {
    const dir = Math.sign(B.x - A.x);
    const x1 = A.x + dir * R; const x2 = B.x - dir * R; const y = A.y;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y} C${mx},${y - 14} ${mx},${y + 14} ${x2},${y}`;
  }
  const down = A.y < B.y;
  const y1 = A.y + (down ? R : -R); const y2 = B.y + (down ? -R : R);
  const my = (y1 + y2) / 2;
  return `M${A.x},${y1} C${A.x},${my} ${B.x},${my} ${B.x},${y2}`;
}

// Pulses (from -> to) that a given event pushes through the wires.
function pulsesFor(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'call.started': return [['caller', 'vapi']];
    case 'speech': return d.role === 'user' ? [['caller', 'vapi']] : [['vapi', 'caller']];
    case 'transcript': return d.role === 'user' ? [['vapi', 'stt'], ['stt', 'tunnel']] : [];
    case 'turn.received': return [['tunnel', 'proxy'], ['knowledge', 'proxy']];
    case 'llm.request': return [['proxy', 'llm']];
    case 'llm.response': return [['llm', 'proxy']];
    case 'tool.started':
      if (d.name === 'book_appointment') return [['proxy', 'cal']];
      if (d.name === 'transferCall') return [['vapi', 'transfer']];
      return [['proxy', 'mongo']];
    case 'tool.finished':
      if (d.name === 'book_appointment') return [['cal', 'proxy'], ['cal', 'sms'], ['cal', 'mail']];
      return [['mongo', 'proxy']];
    case 'db.saved': case 'db.failed': case 'db.skipped': return [['proxy', 'mongo']];
    case 'transfer.returned': return [['proxy', 'tunnel'], ['vapi', 'transfer']];
    case 'response.sent': return [['llm', 'tts']];
    default: return [];
  }
}

function livePulses(call, now) {
  const out = [];
  if (!call) return out;
  for (let i = call.events.length - 1; i >= 0; i--) {
    const e = call.events[i];
    const age = now - new Date(e.ts).getTime();
    if (age > WIRE_HOT_MS) break;
    pulsesFor(e).forEach(([from, to], k) => out.push({ key: `${e.id}-${k}`, from, to, wire: wireId(from, to), age }));
  }
  return out;
}

function activeNode(call) {
  if (!call || call.status === 'ended') return null;
  const last = call.events[call.events.length - 1];
  const t = last?.type; const d = last?.data || {};
  if (call.activeStage === 'tools' || t === 'tool.started') {
    const name = call.activeTool || d.name;
    if (name === 'book_appointment') return 'cal';
    if (name === 'transferCall') return 'transfer';
    return 'mongo';
  }
  if (t === 'transfer.returned') return 'transfer';
  if (t?.startsWith('db.')) return 'mongo';
  return { caller: 'caller', vapi: 'vapi', stt: 'stt', proxy: 'proxy', llm: 'llm', tts: 'tts' }[call.activeStage] || null;
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

function statusLine(call, active, labels) {
  if (!call) return 'Waiting for a call';
  if (call.status === 'ended') return `Call ended${call.endReason ? ` · ${call.endReason}` : ''}`;
  return {
    caller: 'Caller is speaking', vapi: 'Vapi connecting the call', stt: `${labels.stt} transcribing`,
    proxy: 'Triage brain preparing the turn', llm: `${labels.llm} triaging`, tts: `${labels.voice} speaking`,
    mongo: `Saving ${call.activeTool === 'set_disposition' ? 'disposition' : 'patient info'} to MongoDB`,
    cal: 'Booking appointment on Cal.com', transfer: 'Transferring to live operator'
  }[active] || 'In progress';
}

function Pulse({ pulse }) {
  const d = wirePath(pulse.from, pulse.to);
  return (
    <motion.circle
      r="6"
      className="mp-pulse"
      style={{ color: COLORS[pulse.to], offsetPath: `path("${d}")`, offsetRotate: '0deg' }}
      initial={{ offsetDistance: '0%', opacity: 0 }}
      animate={{ offsetDistance: ['0%', '100%', '100%'], opacity: [0, 1, 0] }}
      transition={{ duration: (PULSE_MS + FADE_MS) / 1000, times: [0, PULSE_MS / (PULSE_MS + FADE_MS), 1], ease: ['easeInOut', 'linear'] }}
    />
  );
}

export default function MapDesign({ onSwitch }) {
  const { calls, connected } = useEventStream();
  const [rawConfig, setRawConfig] = useState(FALLBACK_CONFIG);
  const [simulating, setSimulating] = useState(false);
  const [pinned, setPinned] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  useEffect(() => { fetch('/api/config').then((r) => r.json()).then(setRawConfig).catch(() => {}); }, []);

  const labels = useMemo(() => ({
    voice: voiceProviderLabel(rawConfig.voice?.provider), voiceId: rawConfig.voice?.voiceId || '',
    stt: sttProviderLabel(rawConfig.transcriber?.provider), sttModel: rawConfig.transcriber?.model || '',
    llm: rawConfig.model?.model || 'gpt-4o-mini', transferNumber: rawConfig.transferNumber || ''
  }), [rawConfig]);

  const liveCalls = useMemo(() => Object.values(calls).sort((a, b) => new Date(b.lastEventAt) - new Date(a.lastEventAt)), [calls]);
  const auto = liveCalls.find((c) => c.status !== 'ended') || liveCalls[0] || null;
  const call = (pinned && calls[pinned]) || auto;
  const active = activeNode(call);
  const seen = visited(call);
  const pulses = livePulses(call, now);
  const hotWires = new Set(pulses.map((p) => p.wire));
  const wireColor = {}; for (const p of pulses) wireColor[p.wire] = COLORS[p.to];
  const status = statusLine(call, active, labels);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [call?.transcript.length]);

  const simulate = async (scenario) => {
    setSimulating(true); setPinned(null);
    try { await fetch(`/api/simulate?scenario=${scenario}`, { method: 'POST' }); } catch { /* offline */ }
    setTimeout(() => setSimulating(false), 1500);
  };

  const subFor = (id) => ({
    stt: labels.stt,
    llm: labels.llm,
    tts: `${labels.voice}${labels.voiceId ? ` · ${labels.voiceId}` : ''}`,
    transfer: 'Vapi warm transfer'
  })[id] ?? NODES[id].sub;

  const p = call?.patient || {};
  const recent = call ? call.events.slice(-4).reverse() : [];

  return (
    <div className="mp">
      <header className="mp-head">
        <div className="mp-brand"><span className={`mp-dot ${connected ? 'on' : ''}`} />David · Call Flow</div>
        <div className="mp-status">
          <AnimatePresence mode="wait">
            <motion.span key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.3 }}>{status}</motion.span>
          </AnimatePresence>
        </div>
        <div className="mp-actions">
          <button className="ghost" onClick={onSwitch}>Dark design</button>
          <button disabled={simulating} onClick={() => simulate('routine')}>Routine demo</button>
          <button disabled={simulating} className="danger" onClick={() => simulate('emergency')}>Emergency demo</button>
        </div>
      </header>

      <section className="mp-map">
        <svg viewBox="0 0 1220 580" preserveAspectRatio="xMidYMid meet">
          {WIRES.map(([a, b]) => {
            const id = `${a}-${b}`;
            const hot = hotWires.has(id);
            return <path key={id} d={wirePath(a, b)} className={`mp-wire ${hot ? 'hot' : ''}`} style={hot ? { stroke: wireColor[id] } : undefined} />;
          })}
          <AnimatePresence>
            {pulses.map((pl) => <Pulse key={pl.key} pulse={pl} />)}
          </AnimatePresence>
          {Object.entries(NODES).map(([id, n]) => {
            const state = active === id ? 'hot' : seen.has(id) ? 'done' : '';
            return (
              <g key={id} className={`mp-bubble ${state}`} style={{ color: COLORS[id] }} transform={`translate(${n.x},${n.y})`}>
                <motion.circle r={R} className="mp-bubble-glow" animate={{ scale: state === 'hot' ? 1.22 : 1, opacity: state === 'hot' ? 0.28 : 0 }} transition={{ duration: 0.4 }} />
                <motion.circle r={R} className="mp-bubble-fill" animate={{ scale: state === 'hot' ? 1.06 : 1 }} transition={{ duration: 0.4 }} />
                <text y="-2" textAnchor="middle" className="mp-bubble-title">{n.title}</text>
                <text y="15" textAnchor="middle" className="mp-bubble-sub">{subFor(id)}</text>
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
          {call?.transfer && <p className="mp-warn">Transferred to live operator<br /><small>Test operator, not real 911.</small></p>}
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
            <AnimatePresence initial={false}>
              {recent.map((e) => (
                <motion.li key={e.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                  <span>{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>{short(e)}
                </motion.li>
              ))}
            </AnimatePresence>
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
    case 'turn.received': return 'Turn reached triage brain';
    case 'llm.request': return `Sent to ${d.model}`;
    case 'llm.response': return d.finishReason === 'tool_calls' ? `OpenAI → ${d.toolCalls.join(', ')}` : `OpenAI replied (${d.latencyMs} ms)`;
    case 'tool.started': return `Running ${d.name}`;
    case 'tool.finished': return `${d.name} ${d.success ? 'done' : 'failed'}`;
    case 'transfer.returned': return 'Transfer → live operator';
    case 'response.sent': return 'Reply sent to Vapi';
    case 'db.saved': return `MongoDB saved ${d.op}`;
    case 'db.skipped': return `MongoDB skipped ${d.op}`;
    case 'db.failed': return `MongoDB failed ${d.op}`;
    case 'webhook.received': return `Webhook ${d.type}`;
    case 'call.ended': return 'Call ended';
    case 'call.summary': return 'End-of-call report received';
    case 'error': return `Error: ${d.message}`;
    default: return e.type;
  }
}
