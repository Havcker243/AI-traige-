# Agent Triange Backend

This is an older standalone scaffold, not the backend used by the current phone
assistant. Run `npm start` from the repository root for the active `server.js`
and `db.js` implementation. This scaffold's webhook only logs events and its
patient extractor is a stub. Both servers default to port 3000; do not run them
on the same port. Retained for reference, not deleted or migrated.

# Start MongoDB
Make sure MongoDB is running locally.
```bash
npm i
npm run dev
```

Type Check
```bash
npm run typecheck
``` 

* Start Vapi
- Open another terminal and run:
```bash
ngrok http 3000

* Test Server
Invoke-RestMethod http://localhost:3000/health
```
Database:eee
