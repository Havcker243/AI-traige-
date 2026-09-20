import { useEffect, useRef } from 'react';

function fmtDate(iso, tz) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz || undefined });
  } catch { return iso; }
}

export function Transcript({ call }) {
  const endRef = useRef(null);
  const count = call?.transcript.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [count, call?.partialTranscript?.text]);
  return (
    <section className="card transcript">
      <header className="card-head"><h2>Live transcript</h2>{call?.speaking && <span className="badge live">{call.speaking === 'user' ? 'Caller speaking' : 'Assistant speaking'}</span>}</header>
      <div className="bubbles">
        {(call?.transcript || []).map((line, i) => (
          <div key={i} className={`bubble ${line.role}`}>
            <div className="bubble-meta">{line.role === 'user' ? 'Caller' : 'David'}{line.source === 'llm' && <span className="muted"> · model output</span>}</div>
            <div>{line.text}</div>
          </div>
        ))}
        {call?.partialTranscript && (
          <div className={`bubble partial ${call.partialTranscript.role}`}>
            <div className="bubble-meta">{call.partialTranscript.role === 'user' ? 'Caller' : 'David'} · transcribing…</div>
            <div>{call.partialTranscript.text}</div>
          </div>
        )}
        {!count && !call?.partialTranscript && <div className="muted empty">Nothing said yet.</div>}
        <div ref={endRef} />
      </div>
    </section>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="row"><span className="row-label">{label}</span><span className={`row-value ${mono ? 'mono' : ''} ${value ? '' : 'muted'}`}>{value || 'Not captured yet'}</span></div>
  );
}

export function CaseSummary({ call, config }) {
  const p = call?.patient || {};
  return (
    <section className="card case">
      <header className="card-head"><h2>Case record</h2>{call?.callId && <span className="muted mono small">{call.callId}</span>}</header>

      <h3>Disposition</h3>
      <div className="disposition-box">
        {call?.disposition
          ? <span className={`badge big ${call.disposition}`}>{call.disposition === 'emergency' ? 'EMERGENCY' : 'ROUTINE'}</span>
          : <span className="badge big">TRIAGING</span>}
        <span className="muted">{call?.chiefComplaint || 'Chief complaint pending'}</span>
      </div>
      {call?.transfer && (
        <div className="callout emergency">
          Warm transfer handed to Vapi → <span className="mono">{call.transfer.destination}</span>
          <div className="muted small">Configured operator ({config.transferNumber}). Not real 911 — no dispatch is claimed.</div>
        </div>
      )}

      <h3>Patient</h3>
      <Row label="Name" value={p.name} />
      <Row label="Age" value={p.age} />
      <Row label="Sex" value={p.sex} />
      <Row label="Callback" value={p.phone || call?.callerPhone} mono />
      <Row label="Address" value={p.address} />

      <h3>Appointment</h3>
      {call?.booking?.failed && <div className="callout error">Booking failed: {call.booking.error}</div>}
      {call?.booking && !call.booking.failed ? (
        <>
          <Row label="When" value={fmtDate(call.booking.appointmentTime, call.booking.timeZone)} />
          <Row label="With" value={call.booking.doctorName} />
          <Row label="Where" value={call.booking.location} />
          <Row label="Patient email" value="queued via AgentMail" />
          <Row label="Doctor email" value="queued via AgentMail" />
        </>
      ) : !call?.booking && <div className="muted small">No booking yet.</div>}

      <h3>Persistence</h3>
      <div className="db-ops">
        {(call?.db || []).map((d, i) => <span key={i} className={`chip ${d.ok === null ? 'skipped' : d.ok ? 'ok' : 'bad'}`} title={d.error || ''}>{d.op}</span>)}
        {!call?.db?.length && <span className="muted small">No MongoDB writes yet.</span>}
      </div>

      {!!call?.errors?.length && (
        <>
          <h3>Errors</h3>
          {call.errors.map((e, i) => <div key={i} className="callout error">{e.where}: {e.message}</div>)}
        </>
      )}

      {call?.status === 'ended' && (
        <>
          <h3>Call ended</h3>
          <Row label="Reason" value={call.endReason} />
          <Row label="Summary" value={call.summary} />
        </>
      )}
    </section>
  );
}
