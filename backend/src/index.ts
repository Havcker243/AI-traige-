import express from "express";

import { connectDB } from "./db/mongo";
import {
  createCall,
  addTranscript,
  endCall
} from "./db/triage";

const app = express();

app.use(express.json());

const PORT = 3000;

app.get("/", (_req, res) => {
  res.json({
    status: "Agent Triage backend running"
  });
});

app.post("/vapi/webhook", async (req, res) => {
  try {
    console.log("📞 Vapi event received:");
    console.log(JSON.stringify(req.body, null, 2));

    res.status(200).json({
      received: true
    });
  } catch (error) {
    console.error("Webhook error:", error);

    res.status(500).json({
      error: "Webhook failed"
    });
  }
});

async function start() {
  const db = await connectDB();

  await db.command({ ping: 1 });

  console.log("✅ MongoDB connected");
  console.log("✅ Database:", db.databaseName);

  app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);