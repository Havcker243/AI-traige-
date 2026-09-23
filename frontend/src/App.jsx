import { useEffect, useMemo, useState } from 'react';
import { useEventStream } from './hooks/useEventStream.js';
import { voiceProviderLabel, sttProviderLabel } from './lib/callState.js';
import Pipeline from './components/Pipeline.jsx';
import CallList from './components/CallList.jsx';
import Timeline from './components/Timeline.jsx';
import { Transcript, CaseSummary } from './components/Panels.jsx';
import { savedCall } from './lib/savedCall.js';

const FALLBACK_CONFIG = { voice: { provider: 'vapi', voiceId: 'Elliot' }, transcriber: { provider: 'deepgram', model: 'nova-2-general' }, model: { provider: 'custom-llm', model: 'gpt-4o-mini' }, transferNumber: '' };

export default function App({ onSwitch }) {
  const { calls, feed, connected } = useEventStream();
  const [rawConfig, setRawConfig] = useState(FALLBACK_CONFIG);
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [follow, setFollow] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('panel-collapsed') || '{}'); } catch { return {}; }
  });
  const selectedIsLive = Boolean(selectedId && calls[selectedId]);

  const toggleCollapse = (key) => setCollapsed((c) => {
    const next = { ...c, [key]: !c[key] };
    try { localStorage.setItem('panel-collapsed', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then(setRawConfig).catch(() => {});
    const load = () => fetch('/api/calls?limit=30').then((r) => { if (!r.ok) throw new Error('Unable to load saved calls.'); return r.json(); }).then((d) => { if (!Array.isArray(d)) throw new Error('Invalid call history response.'); setHistory(d); setHistoryError(''); }).catch(e => setHistoryError(e.message));
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setDetail(null);
    setDetailError('');
    setDetailLoading(false);
    if (follow || !selectedId || selectedIsLive) return;
    const controller = new AbortController();
    setDetailLoading(true);
    fetch(`/api/calls/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error('Unable to load this saved call.'); return r.json(); })
      .then(record => setDetail(savedCall(record)))
      .catch(e => { if (e.name !== 'AbortError') setDetailError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, follow, selectedIsLive]);

  const config = useMemo(() => ({
    voice: 'ElevenLabs', // Requested presentation label; runtime voice remains Vapi Elliot.
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
  const selected = effectiveId ? calls[effectiveId] || (detail?.callId === effectiveId ? detail : null) : null;
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
          <button className="ghost" onClick={onSwitch}>Map design</button>
          <label className="follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow live call</label>
          <button disabled={simulating} onClick={() => simulate('routine')}>Simulate routine call</button>
          <button disabled={simulating} className="danger" onClick={() => simulate('emergency')}>Simulate emergency</button>
        </div>
      </header>

      {historyError && <div role="alert" className="callout error">{historyError}</div>}
      <div className="muted small" style={{ padding: '8px 18px 0' }}>Drag a panel's bottom-right corner to resize it. Scroll inside a panel to read more.</div>
      {detailError && <div role="alert" className="callout error">{detailError}</div>}
      {detailLoading && <div role="status">Loading saved call...</div>}
      <main className="grid">
        <CallList
          liveCalls={liveCalls}
          history={history}
          selectedId={effectiveId}
          onSelect={(id) => { setFollow(false); setSelectedId(id); }}
          collapsed={!!collapsed.calls}
          onToggleCollapse={() => toggleCollapse('calls')}
        />
        <div className="center">
          <Pipeline
            call={selected}
            config={config}
            collapsed={!!collapsed.pipeline}
            onToggleCollapse={() => toggleCollapse('pipeline')}
          />
          <Timeline
            events={selectedEvents}
            collapsed={!!collapsed.timeline}
            onToggleCollapse={() => toggleCollapse('timeline')}
          />
        </div>
        <div className="side">
          <Transcript
            call={selected}
            collapsed={!!collapsed.transcript}
            onToggleCollapse={() => toggleCollapse('transcript')}
          />
          <CaseSummary
            call={selected}
            config={config}
            collapsed={!!collapsed.case}
            onToggleCollapse={() => toggleCollapse('case')}
          />
        </div>
      </main>
    </div>
  );
}
