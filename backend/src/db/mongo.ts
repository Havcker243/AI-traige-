import { config } from "dotenv";
import { MongoClient } from "mongodb";

config();

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is missing from .env");
}

const client = new MongoClient(uri, {
  family: 4
});

export async function connectDB() {
  await client.connect();

  const db = client.db(
    process.env.MONGODB_DB || "agent_triage"
  );

  console.log("✅ MongoDB connected");

  return db;
}