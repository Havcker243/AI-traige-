require('dotenv').config();
const { MongoClient } = require('mongodb');
if (process.env.MONGODB_DNS_SERVERS) {
  require('node:dns').setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(s => s.trim()).filter(Boolean));
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'agent-triage';

let clientPromise = null;

// Lazily connects once and reuses the connection. Returns null (rather than
// throwing) when Mongo isn't configured or unreachable, so a DB outage never
// takes down the call itself — persistence is best-effort, the phone call is not.
function getClient() {
  if (!uri) return null;
  if (!clientPromise) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
    clientPromise = client.connect().then(() => client).catch(async (err) => {
      await client.close().catch(() => {});
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

async function getCalls() {
  const client = await getClient();
  if (!client) return null;
  return client.db(dbName).collection('triage_calls');
}

async function upsertTranscript(callId, messages, callerPhone) {
  if (!callId) return;
  const calls = await getCalls();
  if (!calls) return;
  const transcript = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  const set = { transcript, updatedAt: new Date() };
  // Caller ID as reported by Vapi — saved unconditionally on every turn, independent
  // of whether the caller ever states/confirms a callback number during the call.
  if (callerPhone) set.callerPhone = callerPhone;

  await calls.updateOne(
    { callId },
    {
      $set: set,
      // createdAt on first write doubles as "call started" — the first /chat/completions
      // turn fires immediately once Vapi connects the call, so this is accurate to the second.
      $setOnInsert: { callId, status: 'active', patient: {}, createdAt: new Date() }
    },
    { upsert: true }
  );
}

async function savePatientInfo(callId, info) {
  if (!callId) return false;
  const calls = await getCalls();
  if (!calls) return false;
  const updates = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(info)) {
    if (value !== undefined && value !== null && value !== '') {
      updates[`patient.${key}`] = value;
    }
  }
  if (Object.keys(updates).length === 1) return false; // nothing but updatedAt

  await calls.updateOne(
    { callId },
    { $set: updates, $setOnInsert: { callId, status: 'active', transcript: [], createdAt: new Date() } },
    { upsert: true }
  );
  return true;
}

async function recordBooking(callId, booking) {
  if (!callId) return;
  const calls = await getCalls();
  if (!calls) return;
  await calls.updateOne(
    { callId },
    {
      $set: {
        bookingUid: booking.bookingUid,
        appointmentTime: booking.start,
        timeZone: booking.timeZone,
        location: booking.location,
        updatedAt: new Date()
      },
      $setOnInsert: { callId, status: 'active', patient: {}, transcript: [], createdAt: new Date() }
    },
    { upsert: true }
  );
}

async function recordDisposition(callId, { disposition, chiefComplaint, redFlag }) {
  if (!callId) return;
  const calls = await getCalls();
  if (!calls) return;
  const updates = { updatedAt: new Date() };
  if (disposition) updates.disposition = disposition;
  if (chiefComplaint) updates.chiefComplaint = chiefComplaint;
  if (typeof redFlag === 'boolean') updates.redFlag = redFlag;

  await calls.updateOne(
    { callId },
    { $set: updates, $setOnInsert: { callId, status: 'active', patient: {}, transcript: [], createdAt: new Date() } },
    { upsert: true }
  );
}


// Stores Vapi's own end-of-call-report verbatim (under vapiReport) so nothing it
// sends — recording URL, cost, analysis, exact duration, etc. — is ever lost to a
// field name we didn't think to pull out, plus convenience top-level copies of the
// fields we know we'll want to query on directly.
async function recordEndOfCallReport(callId, message, callerPhone) {
  if (!callId) return;
  const calls = await getCalls();
  if (!calls) return;

  const updates = {
    status: 'completed',
    endedAt: new Date(),
    updatedAt: new Date(),
    vapiReport: message
  };
  if (message?.endedReason) updates.endedReason = message.endedReason;
  if (typeof message?.durationSeconds === 'number') updates.durationSeconds = message.durationSeconds;
  if (message?.startedAt) updates.callStartedAt = new Date(message.startedAt);
  if (message?.recordingUrl || message?.artifact?.recordingUrl) {
    updates.recordingUrl = message.recordingUrl || message.artifact.recordingUrl;
  }
  if (message?.summary) updates.vapiSummary = message.summary;
  if (typeof message?.cost === 'number') updates.cost = message.cost;
  if (callerPhone) updates.callerPhone = callerPhone;

  await calls.updateOne(
    { callId },
    {
      $set: updates,
      $setOnInsert: {
        callId,
        patient: {},
        transcript: [],
        createdAt: message?.startedAt ? new Date(message.startedAt) : new Date()
      }
    },
    { upsert: true }
  );
}

async function getCall(callId) {
  if (!callId) return null;
  const calls = await getCalls();
  if (!calls) return null;
  return calls.findOne({ callId });
}

async function listCalls(limit = 50) {
  const calls = await getCalls();
  if (!calls) return [];
  return calls.find({}, { projection: { vapiReport: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

async function getPatientInfo(callId) {
  const call = await getCall(callId);
  return call?.patient || {};
}

module.exports = {
  upsertTranscript, savePatientInfo, recordBooking, recordDisposition,
  recordEndOfCallReport, getCall, listCalls, getPatientInfo
};
