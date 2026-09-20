import { STAGES, TOOL_STAGES } from '../lib/callState.js';

function stageState(call, stage) {
  if (!call) return 'idle';
  if (call.status === 'ended') return 'done';
  if (call.activeStage === stage.id) return 'active';
  const seen = call.events.some((e) => {
    switch (stage.id) {
      case 'caller': return e.type === 'call.started' || (e.type === 'speech' && e.data?.role === 'user');
      case 'vapi': return true;
      case 'stt': return e.type === 'transcript' || e.type === 'turn.received';
      case 'proxy': return e.type === 'turn.received';
      case 'llm': return e.type === 'llm.request';
      case 'tools': return e.type === 'tool.started' || e.type === 'transfer.returned';
      case 'tts': return e.type === 'response.sent' || (e.type === 'speech' && e.data?.role === 'assistant');
      default: return false;
    }
  });
  return seen ? 'done' : 'idle';
}

function toolState(call, tool) {
  if (!call) return 'idle';
  if (call.activeTool === tool.id && call.status !== 'ended') return 'active';
  if (tool.id === 'transferCall') return call.transfer ? 'done' : 'idle';
  const runs = call.tools.filter((t) => t.name === tool.id);
  if (!runs.length) return 'idle';
  return runs.some((t) => t.success === false) ? 'failed' : 'done';
}

function stageDetail(call, stage, config) {
  if (!call) return stage.sub;
  switch (stage.id) {
    case 'caller':
      return call.speaking === 'user' ? 'Speaking…' : (call.callerPhone || stage.sub);
    case 'stt':
      return call.partialTranscript?.role === 'user' ? `“${call.partialTranscript.text}”` : config.stt;
    case 'proxy':
      return `${call.turns} turn${call.turns === 1 ? '' : 's'} · ${call.db.filter((d) => d.ok).length} DB writes`;
    case 'llm': {
      const last = call.llmCalls[call.llmCalls.length - 1];
      if (!last) return config.llm;
      if (last.pending) return `${config.llm} · thinking…`;
      return `${config.llm} · ${last.latencyMs != null ? `${last.latencyMs} ms` : last.finishReason}`;
    }
    case 'tools':
      return call.activeTool || `${call.tools.length} call${call.tools.length === 1 ? '' : 's'}`;
    case 'tts':
      return call.speaking === 'assistant' ? `${config.voice} · speaking…` : config.voice;
    default:
      return stage.sub;
  }
}

export default function Pipeline({ call, config }) {
  return (
    <section className="pipeline card">
      <header className="card-head">
        <h2>Live pipeline</h2>
        <span className="muted">{call ? (call.status === 'ended' ? 'Call finished' : 'In progress') : 'Waiting for a call'}</span>
      </header>
      <div className="stages">
        {STAGES.map((stage, i) => {
          const state = stageState(call, stage);
          return (
            <div key={stage.id} className="stage-wrap">
              <div className={`stage ${state}`}>
                <div className="stage-label">{stage.label}</div>
                <div className="stage-sub">{stageDetail(call, stage, config)}</div>
                {state === 'active' && <span className="pulse" />}
              </div>
              {i < STAGES.length - 1 && <div className={`arrow ${state === 'active' ? 'flow' : ''}`}>›</div>}
            </div>
          );
        })}
      </div>
      <div className="tool-row">
        {TOOL_STAGES.map((tool) => {
          const state = toolState(call, tool);
          return (
            <div key={tool.id} className={`tool-chip ${state}`}>
              <span className="dot" />
              <div>
                <div className="tool-name">{tool.label}</div>
                <div className="stage-sub">{tool.sub}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
