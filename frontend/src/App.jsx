import { useEffect, useMemo, useState } from 'react';
import { useEventStream } from './hooks/useEventStream.js';
import { voiceProviderLabel, sttProviderLabel } from './lib/callState.js';
import Pipeline from './components/Pipeline.jsx';
import CallList from './components/CallList.jsx';
import Timeline from './components/Timeline.jsx';
import { Transcript, CaseSummary } from './components/Panels.jsx';

const FALLBACK_CONFIG = { voice: { provider: 'vapi', voiceId: 'Elliot' }, transcriber: { provider: 'deepgram', model: 'nova-2-general' }, model: { provider: 'custom-llm', model: 'gpt-4o-mini' }, transferNumber: '' };

export default function App() {
  const { calls, feed, connected } = useEventStream();
  const [rawConfig, setRawConfig] = useState(FALLBACK_CONFIG);
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [follow, setFollow] = useState(true);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then(setRawConfig).catch(() => {});
    const load = () => fetch('/api/calls?limit=30').then((r) => r.json()).then((d) => setHistory(Array.isArray(d) ? d : [])).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const config = useMemo(() => ({
    voice: `${voiceProviderLabel(rawConfig.voice?.provider)}${rawConfig.voice?.voiceId ? ` · ${rawConfig.voice.voiceId}` : ''}`,
    stt: `${sttProviderLabel(rawConfig.transcriber?.provider)}${rawConfig.transcriber?.model ? ` · ${rawConfig.transcriber.model}` : ''}`,
    llm: rawConfig.model?.model || 'gpt-4o-mini',
    transferNumber: rawConfig.transferNumber || '—'
  }), [rawConfig]);

  const liveCalls = useMemo(
    () => Object.values(calls).sort((a, b) => new Date(b.lastEventAt || b.startedAt) - new Date(a.lastEventAt || a.startedAt)),
    [calls]
  );

  const followedId = useMemo(() => {
    if (!liveCalls.length) return null;
    const active = liveCalls.find((c) => c.status !== 'ended') || liveCalls[0];
    return active.callId || '__no_call__';
  }, [liveCalls]);

  const effectiveId = follow ? followedId : selectedId;
  const selected = effectiveId ? calls[effectiveId] : null;
  const selectedEvents = selected ? selected.events : feed;

  const simulate = async (scenario) => {
    setSimulating(true);
    setFollow(true);
    try { await fetch(`/api/simulate?scenario=${scenario}`, { method: 'POST' }); } catch { /* server offline */ }
    setTimeout(() => setSimulating(false), 1500);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className={`conn ${connected ? 'on' : 'off'}`} />
          <h1>David · Triage Live</h1>
          <span className="muted">{connected ? 'connected to proxy' : 'reconnecting…'}</span>
        </div>
        <div className="config-chips">
          <span className="chip">STT: {config.stt}</span>
          <span className="chip">LLM: {config.llm}</span>
          <span className="chip">Voice: {config.voice}</span>
          <span className="chip">Transfer: <span className="mono">{config.transferNumber}</span></span>
        </div>
        <div className="actions">
          <label className="follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow live call</label>
          <button disabled={simulating} onClick={() => simulate('routine')}>Simulate routine call</button>
          <button disabled={simulating} className="danger" onClick={() => simulate('emergency')}>Simulate emergency</button>
        </div>
      </header>

      <main className="grid">
        <CallList liveCalls={liveCalls} history={history} selectedId={effectiveId} onSelect={(id) => { setFollow(false); setSelectedId(id); }} />
        <div className="center">
          <Pipeline call={selected} config={config} />
          <Timeline events={selectedEvents} />
        </div>
        <div className="side">
          <Transcript call={selected} />
          <CaseSummary call={selected} config={config} />
        </div>
      </main>
    </div>
  );
}
