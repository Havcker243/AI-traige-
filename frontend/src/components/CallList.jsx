function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function CallList({ liveCalls, history, selectedId, onSelect }) {
  const liveIds = new Set(liveCalls.map((c) => c.callId));
  const past = history.filter((h) => !liveIds.has(h.callId));
  return (
    <aside className="card calls">
      <header className="card-head"><h2>Calls</h2><span className="muted">{liveCalls.length} live</span></header>
      <ul>
        {liveCalls.map((c) => (
          <li key={c.callId || 'none'} className={`call-item ${selectedId === (c.callId || '__no_call__') ? 'selected' : ''}`} onClick={() => onSelect(c.callId || '__no_call__')}>
            <div className="call-top">
              <span className={`status-dot ${c.status}`} />
              <strong>{c.patient.name || c.callerPhone || (c.callId ? c.callId.slice(0, 14) : 'No call id')}</strong>
              <span className="muted right">{fmtTime(c.startedAt)}</span>
            </div>
            <div className="muted small">
              {c.disposition ? <span className={`badge ${c.disposition}`}>{c.disposition}</span> : <span className="badge">triaging</span>}
              {' '}{c.chiefComplaint || (c.callId?.startsWith('sim-') ? 'simulated call' : '')}
            </div>
          </li>
        ))}
        {past.length > 0 && <li className="divider">Earlier (MongoDB)</li>}
        {past.map((h) => (
          <li key={h.callId} className={`call-item ${selectedId === h.callId ? 'selected' : ''}`} onClick={() => onSelect(h.callId)}>
            <div className="call-top">
              <span className="status-dot ended" />
              <strong>{h.patient?.name || h.callerPhone || h.callId.slice(0, 14)}</strong>
              <span className="muted right">{h.createdAt ? new Date(h.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
            </div>
            <div className="muted small">
              {h.disposition && <span className={`badge ${h.disposition}`}>{h.disposition}</span>} {h.chiefComplaint || ''}
            </div>
          </li>
        ))}
        {!liveCalls.length && !past.length && <li className="muted empty">No calls yet. Start a simulation or place a call.</li>}
      </ul>
    </aside>
  );
}
