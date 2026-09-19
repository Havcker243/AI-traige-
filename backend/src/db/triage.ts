// src/db/triage.ts

import { ObjectId } from "mongodb";
import { connectDB } from "./mongo";

export async function createTriageSession(
  callId: string,
  phone: string
) {
  const db = await connectDB();

  const result = await db.collection("triage_sessions").insertOne({
    callId,
    phone,

    status: "active",

    answers: {},

    redFlags: [],

    disposition: null,

    createdAt: new Date(),
    updatedAt: new Date()
  });

  return result.insertedId;
}