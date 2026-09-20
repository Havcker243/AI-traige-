const { EventEmitter } = require('node:events');

const bus = new EventEmitter();
bus.setMaxListeners(100);
const recent = [];
const MAX_RECENT = 500;
let seq = 0;
const startedCallIds = new Set();
const endedCallIds = new Set();
const MAX_TRACKED_CALLS = 1000;

function emitEvent(type, callId, data = {}) {
  const event = {
    id: ++seq,
    ts: new Date().toISOString(),
    type,
    callId: callId || null,
    data
  };
  recent.push(event);
  if (recent.length > MAX_RECENT) recent.shift();
  bus.emit('event', event);
  return event;
}

function subscribe(fn) {
  bus.on('event', fn);
  return () => bus.off('event', fn);
}

function recentEvents() {
  return [...recent];
}

function markTracked(set, callId) {
  if (!callId || set.has(callId)) return false;
  set.add(callId);
  if (set.size > MAX_TRACKED_CALLS) set.delete(set.values().next().value);
  return true;
}

function emitCallStarted(callId, data = {}) {
  if (callId && !markTracked(startedCallIds, callId)) return null;
  return emitEvent('call.started', callId, data);
}

function emitCallEnded(callId, data = {}) {
  if (callId && !markTracked(endedCallIds, callId)) {
    const details = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== null && value !== undefined)
    );
    return Object.keys(details).length ? emitEvent('call.summary', callId, details) : null;
  }
  return emitEvent('call.ended', callId, data);
}

module.exports = {
  emitEvent,
  subscribe,
  recentEvents,
  emitCallStarted,
  emitCallEnded
};
