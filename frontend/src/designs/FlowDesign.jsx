import { useEffect, useMemo, useRef, useState } from 'react';
import { useEventStream } from '../hooks/useEventStream.js';
import { STAGES, TOOL_STAGES, voiceProviderLabel, sttProviderLabel } from '../lib/callState.js';
import './flow.css';

const FALLBACK_CONFIG = { voice: { provider: 'vapi', voiceId: 'Elliot' }, transcriber: { provider: 'deepgram', model: 'nova-2-general' }, model: { provider: 'custom-llm', model: 'gpt-4o-mini' }, transferNumber: '' };

const STAGE_ICON = { caller: '1', vapi: '2', stt: '3', proxy: '4', llm: '5', tools: '6', tts: '7' };

function nowText(call, config) {
  if (!call) return { title: 'Waiting for a call', sub: 'Start a simulation or dial the assistant.' };
  if (call.status === 'ended') return { title: 'Call finished', sub: call.endReason || '' };
  switch (call.activeStage) {
    case 'caller': return { title: 'Caller is speaking', sub: call.partialTranscript?.text ? `“${call.partialTranscript.text}”` : 'Listening…' };
    case 'stt': return { title: `${config.stt} is transcribing`, sub: call.partialTranscript?.text ? `“${call.partialTranscript.text}”` : 'Turning speech into text' };
    case 'proxy': return { title: 'Safety-net proxy received the turn', sub: 'Injecting triage question library and booking rules' };
    case 'llm': return { title: `${config.llm} is triaging`, sub: 'Reasoning over symptoms, red flags and next question' };
    case 'tools': return { title: call.activeTool ? `Running ${call.activeTool}` : 'Executing tools', sub: toolSub(call.activeTool) };
    case 'tts': return { title: `${config.voice} is speaking`, sub: lastAssistantLine(call) };
    case 'vapi': return { title: 'Vapi is handling the call', sub: call.transfer ? `Warm transfer to ${call.transfer.destination}` : 'Connecting…' };
    default: return { title: 'In progress', sub: '' };
  }
}

function toolSub(name) {
  return {
    save_patient_info: 'Writing caller details to MongoDB',
    set_disposition: 'Recording triage outcome in MongoDB',
    book_appointment: 'Cal.com booking → AgentPhone SMS → AgentMail doctor notes',
    transferCall: 'Handing the call to Vapi for a warm transfer'
  }[name] || '';
}

function lastAssistantLine(call) {
  const line = [...call.transcript].reverse().find((l) => l.role === 'assistant');
  return line ? `“${line.text}”` : '';
}

function stageStatus(call, stage) {
  if (!call) return 'idle';
  if (call.status !== 'ended' && call.activeStage === stage.id) return 'active';
  const touched = call.events.some((e) => ({
    caller: e.type === 'call.started', vapi: true, stt: e.type === 'transcript' || e.type === 'turn.received', proxy: e.type === 'turn.received',
    llm: e.type === 'llm.request', tools: e.type === 'tool.started' || e.type === 'transfer.returned', tts: e.type === 'response.sent'
  })[stage.id]);
  return touched ? 'done' : 'idle';
}

function stageMeta(call, stage, config) {
  if (!call) return { caller: '—', vapi: 'Telephony', stt: config.stt, proxy: 'server.js', llm: config.llm, tools: 'Intake · Disposition · Booking', tts: config.voice }[stage.id];
  switch (stage.id) {
    case 'caller': return call.callerPhone || 'Unknown number';
    case 'vapi': return `${call.events.filter((e) => e.type === 'webhook.received').length || call.events.filter((e) => e.type === 'speech').length} events`;
    case 'stt': return `${config.stt} · ${call.transcript.filter((l) => l.role === 'user').length} utterances`;
    case 'proxy': return `${call.turns} turns · ${call.db.filter((d) => d.ok).length} saved`;
    case 'llm': {
      const done = call.llmCalls.filter((c) => !c.pending);
      const avg = done.length ? Math.round(done.reduce((s, c) => s + (c.latencyMs || 0), 0) / done.length) : null;
      return `${config.llm} · ${call.llmCalls.length} calls${avg != null ? ` · avg ${avg} ms` : ''}`;
    }
    case 'tools': return `${call.tools.length} executed${call.transfer ? ' · transfer' : ''}`;
    case 'tts': return config.voice;
    default: return '';
  }
}

function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(ts)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function FlowDesign({ onSwitch }) {
  const { calls, feed, connected } = useEventStream();
  const [rawConfig, setRawConfig] = useState(FALLBACK_CONFIG);
  const [history, setHistory] = useState([]);
  const [pinned, setPinned] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [, tick] = useState(0);
  const feedEnd = useRef(null);

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then(setRawConfig).catch(() => {});
    const load = () => fetch('/api/calls?limit=20').then((r) => r.json()).then((d) => setHistory(Array.isArray(d) ? d : [])).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    const clock = setInterval(() => tick((n) => n + 1), 5000);
    return () => { clearInterval(t); clearInterval(clock); };
  }, []);

  const config = useMemo(() => ({
    voice: `${voiceProviderLabel(rawConfig.voice?.provider)}${rawConfig.voice?.voiceId ? ` (${rawConfig.voice.voiceId})` : ''}`,
    stt: sttProviderLabel(rawConfig.transcriber?.provider),
    llm: rawConfig.model?.model || 'gpt-4o-mini',
    transferNumber: rawConfig.transferNumber || '—'
  }), [rawConfig]);

  const liveCalls = useMemo(() => Object.values(calls).sort((a, b) => new Date(b.lastEventAt) - new Date(a.lastEventAt)), [calls]);
  const auto = liveCalls.find((c) => c.status !== 'ended') || liveCalls[0] || null;
  const call = pinned ? calls[pinned] || auto : auto;
  const events = call ? call.events : feed;
  const now = nowText(call, config);

  useEffect(() => { feedEnd.current?.scrollIntoView({ block: 'nearest' }); }, [events.length]);

  const simulate = async (scenario) => {
    setSimulating(true); setPinned(null);
    try { await fetch(`/api/simulate?scenario=${scenario}`, { method: 'POST' }); } catch { /* offline */ }
    setTimeout(() => setSimulating(false), 1500);
  };

  const p = call?.patient || {};

  return (
    <div className="fl">
      <nav className="fl-nav">
        <div className="fl-brand">
          <div className="fl-logo">D</div>
          <div>
            <div className="fl-title">David · Triage Control Room</div>
            <div className="fl-sub">{connected ? <><span className="fl-dot on" /> Live from proxy</> : <><span className="fl-dot" /> Reconnecting…</>}</div>
          </div>
        </div>
        <div className="fl-providers">
          <span><b>STT</b> {config.stt}</span>
          <span><b>LLM</b> {config.llm}</span>
          <span><b>Voice</b> {config.voice}</span>
          <span><b>Transfer</b> {config.transferNumber}</span>
        </div>
        <div className="fl-actions">
          <button className="ghost" onClick={onSwitch}>Switch to dark design</button>
          <button disabled={simulating} onClick={() => simulate('routine')}>▶ Routine demo</button>
          <button disabled={simulating} className="red" onClick={() => simulate('emergency')}>▶ Emergency demo</button>
        </div>
      </nav>

      <div className="fl-body">
        {/* Column 1: flow */}
        <section className="fl-flow">
          <div className="fl-now">
            <div className="fl-now-label">RIGHT NOW</div>
            <div className="fl-now-title">{now.title}</div>
            <div className="fl-now-sub">{now.sub}</div>
            {call && <div className="fl-now-meta">{call.callId} · started {ago(call.startedAt)}</div>}
          </div>
          <ol className="fl-steps">
            {STAGES.map((stage, i) => {
              const st = stageStatus(call, stage);
              return (
                <li key={stage.id} className={`fl-step ${st}`}>
                  <div className="fl-rail">
                    <div className="fl-node">{STAGE_ICON[stage.id]}</div>
                    {i < STAGES.length - 1 && <div className={`fl-line ${st === 'active' ? 'flow' : ''}`} />}
                  </div>
                  <div className="fl-step-body">
                    <div className="fl-step-title">{stage.label} {st === 'active' && <span className="fl-live">LIVE</span>}</div>
                    <div className="fl-step-meta">{stageMeta(call, stage, config)}</div>
                    {stage.id === 'tools' && (
                      <div className="fl-tools">
                        {TOOL_STAGES.map((t) => {
                          const runs = call?.tools.filter((r) => r.name === t.id) || [];
                          const active = call?.activeTool === t.id && call?.status !== 'ended';
                          const done = t.id === 'transferCall' ? !!call?.transfer : runs.length > 0;
                          const failed = runs.some((r) => r.success === false);
                          return <span key={t.id} className={`fl-tool ${active ? 'active' : failed ? 'failed' : done ? 'done' : ''}`}>{t.label}{runs.length > 1 ? ` ×${runs.length}` : ''}</span>;
                        })}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Column 2: conversation + feed */}
        <section className="fl-middle">
          <div className="fl-card fl-convo">
            <div className="fl-card-head"><h3>Conversation</h3>{call?.speaking && <span className={`fl-speaking ${call.speaking}`}>{call.speaking === 'user' ? '● Caller speaking' : '● David speaking'}</span>}</div>
            <div className="fl-lines">
              {(call?.transcript || []).map((l, i) => (
                <div key={i} className={`fl-line-msg ${l.role}`}>
                  <span className="fl-who">{l.role === 'user' ? 'Caller' : 'David'}</span>
                  <span className="fl-text">{l.text}</span>
                </div>
              ))}
              {call?.partialTranscript && <div className={`fl-line-msg partial ${call.partialTranscript.role}`}><span className="fl-who">…</span><span className="fl-text">{call.partialTranscript.text}</span></div>}
              {!call?.transcript.length && <div className="fl-empty">The conversation will appear here.</div>}
            </div>
          </div>
          <div className="fl-card fl-feed">
            <div className="fl-card-head"><h3>What the system is doing</h3><span className="fl-muted">{events.length} steps</span></div>
            <ul>
              {events.slice(-60).map((e) => <li key={e.id} className={`fl-ev ${kind(e.type)}`}><span className="fl-ev-t">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span><span className="fl-ev-msg">{plain(e)}</span></li>)}
              <li ref={feedEnd} />
            </ul>
          </div>
        </section>

        {/* Column 3: outcome */}
        <section className="fl-right">
          <div className={`fl-card fl-outcome ${call?.disposition || ''}`}>
            <div className="fl-card-head"><h3>Triage outcome</h3></div>
            <div className="fl-outcome-big">{call?.disposition ? call.disposition.toUpperCase() : 'TRIAGING…'}</div>
            <div className="fl-muted">{call?.chiefComplaint || 'Chief complaint not yet identified'}</div>
            {call?.transfer && <div className="fl-alert">Warm transfer to operator <b>{call.transfer.destination}</b><br /><small>Configured test operator, not real 911. No dispatch is claimed.</small></div>}
          </div>

          <div className="fl-card">
            <div className="fl-card-head"><h3>Caller</h3></div>
            <dl className="fl-dl">
              <dt>Name</dt><dd>{p.name || <i>—</i>}</dd>
              <dt>Age</dt><dd>{p.age || <i>—</i>}</dd>
              <dt>Sex</dt><dd>{p.sex || <i>—</i>}</dd>
              <dt>Phone</dt><dd>{p.phone || call?.callerPhone || <i>—</i>}</dd>
              <dt>Address</dt><dd>{p.address || <i>—</i>}</dd>
            </dl>
          </div>

          <div className="fl-card">
            <div className="fl-card-head"><h3>Appointment & follow-up</h3></div>
            {call?.booking && !call.booking.failed ? (
              <dl className="fl-dl">
                <dt>When</dt><dd>{new Date(call.booking.appointmentTime).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: call.booking.timeZone })}</dd>
                <dt>With</dt><dd>{call.booking.doctorName}</dd>
                <dt>Where</dt><dd>{call.booking.location}</dd>
                <dt>SMS</dt><dd><span className={`fl-pill ${call.sms?.status === 'delivered' ? 'ok' : call.sms?.status === 'submitted' ? 'warn' : ''}`}>{call.sms?.status || 'none'}</span></dd>
                <dt>Doctor</dt><dd><span className="fl-pill ok">notes emailed</span></dd>
              </dl>
            ) : call?.booking?.failed ? <div className="fl-alert">Booking failed: {call.booking.error}</div> : <div className="fl-empty">No appointment booked.</div>}
          </div>

          <div className="fl-card">
            <div className="fl-card-head"><h3>Saved to MongoDB</h3></div>
            <div className="fl-pills">
              {(call?.db || []).map((d, i) => <span key={i} className={`fl-pill ${d.ok === null ? '' : d.ok ? 'ok' : 'bad'}`} title={d.error || ''}>{d.op}</span>)}
              {!call?.db?.length && <span className="fl-empty">Nothing yet.</span>}
            </div>
          </div>

          <div className="fl-card fl-calls">
            <div className="fl-card-head"><h3>Calls</h3><span className="fl-muted">{liveCalls.length} in session</span></div>
            <ul>
              {liveCalls.map((c) => (
                <li key={c.callId || 'none'} className={c === call ? 'sel' : ''} onClick={() => setPinned(c.callId || '__no_call__')}>
                  <span className={`fl-dot ${c.status === 'ended' ? '' : 'on'}`} />
                  <span>{c.patient.name || c.callerPhone || c.callId}</span>
                  <span className={`fl-pill ${c.disposition || ''}`}>{c.disposition || 'triaging'}</span>
                </li>
              ))}
              {history.filter((h) => !calls[h.callId]).slice(0, 8).map((h) => (
                <li key={h.callId} className="past"><span className="fl-dot" /><span>{h.patient?.name || h.callerPhone || h.callId}</span><span className="fl-muted">{h.createdAt ? new Date(h.createdAt).toLocaleDateString() : ''}</span></li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function kind(type) {
  if (type.startsWith('llm')) return 'llm';
  if (type.startsWith('tool') || type === 'transfer.returned') return 'tool';
  if (type.startsWith('db')) return 'db';
  if (type === 'error' || type === 'db.failed') return 'err';
  if (type === 'transcript' || type === 'speech') return 'voice';
  return 'sys';
}

function plain(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'call.started': return `Call started${d.callerPhone ? ` from ${d.callerPhone}` : ''}`;
    case 'status': return `Vapi status: ${d.status}`;
    case 'speech': return `${d.role === 'user' ? 'Caller' : 'David'} ${d.status === 'started' ? 'started' : 'stopped'} speaking`;
    case 'transcript': return `${d.transcriptType === 'partial' ? 'Transcribing' : 'Transcribed'} (${d.role}): “${d.text}”`;
    case 'turn.received': return `Proxy received a new turn (${d.messageCount} messages in context)`;
    case 'llm.request': return `Asked ${d.model} (${d.messageCount} msgs, ${d.tools?.length || 0} tools)`;
    case 'llm.response': return d.finishReason === 'tool_calls' ? `${d.model || 'Model'} wants to run: ${d.toolCalls.join(', ')} (${d.latencyMs} ms)` : `Model replied in ${d.latencyMs} ms: “${d.contentPreview}”`;
    case 'tool.started': return `Running ${d.name} ${d.args ? JSON.stringify(d.args) : ''}`;
    case 'tool.finished': return `${d.name} ${d.success ? 'succeeded' : 'failed'} (${d.latencyMs} ms)`;
    case 'transfer.returned': return `Handed warm transfer to Vapi → ${d.destination}`;
    case 'response.sent': return `Reply sent to Vapi (${d.stream ? 'streaming' : 'JSON'}, ${d.finishReason})`;
    case 'db.saved': return `Saved ${d.op} to MongoDB`;
    case 'db.skipped': return `Skipped MongoDB write (${d.op}): ${d.reason}`;
    case 'db.failed': return `MongoDB ${d.op} failed: ${d.error}`;
    case 'webhook.received': return `Vapi webhook: ${d.type}`;
    case 'call.ended': return `Call ended (${d.reason || 'unknown'})${d.durationSeconds ? ` after ${d.durationSeconds}s` : ''}`;
    case 'error': return `Error in ${d.where}: ${d.message}`;
    default: return e.type;
  }
}
