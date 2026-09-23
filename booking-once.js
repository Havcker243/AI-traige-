// One booking attempt per call, including concurrent or ambiguous retry requests.
// This process-local guard lasts 24 hours; it is not durable across restarts.
const attempts = new Map();
function bookOnce(callId, action) {
  if (!callId) return action();
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.expires < now) attempts.delete(key);
  }
  if (!attempts.has(callId)) {
    attempts.set(callId, { expires: now + 86400000, promise: Promise.resolve().then(action) });
  }
  return attempts.get(callId).promise;
}
module.exports = { bookOnce };
