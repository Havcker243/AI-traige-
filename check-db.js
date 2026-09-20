require('dotenv').config();
const { MongoClient } = require('mongodb');
const dns = require('node:dns');
const dnsServer = process.argv.find(arg => arg.startsWith('--dns='))?.slice(6);
if (dnsServer || process.env.MONGODB_DNS_SERVERS) {
  dns.setServers((dnsServer || process.env.MONGODB_DNS_SERVERS).split(',').map(s => s.trim()).filter(Boolean));
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000
  });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'agent-triage');
    await db.command({ ping: 1 });
    console.log(JSON.stringify({ database: db.databaseName, connected: true,
      callRecords: await db.collection('triage_calls').estimatedDocumentCount() }));
  } finally { await client.close(); }
}
main().catch(error => {
  console.error(JSON.stringify({ connected: false, configured: Boolean(process.env.MONGODB_URI), errorType: error.name, code: error.code, syscall: error.syscall,
    hint: 'Check Atlas connectivity, network access, and credentials; no records were changed.' }));
  process.exitCode = 1;
});
