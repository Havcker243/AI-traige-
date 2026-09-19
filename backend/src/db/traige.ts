import { connectDB } from "./mongo";

import type {
  PatientInfo,
  TriageCall
} from "../models/TriageCall";


export async function createCall(
  callId: string,
  phone?: string
) {
  const db = await connectDB();

  const call: TriageCall = {
    callId,

    status: "active",

    patient: phone ? { phone } : {},

    durationSeconds: 0,

    transcripts: [],

    possibleSymptoms: [],

    createdAt: new Date(),

    updatedAt: new Date()
  };

  return db
    .collection<TriageCall>("triage_calls")
    .insertOne(call);
}


export async function addTranscript(
  callId: string,
  speaker: "patient" | "agent",
  text: string
) {
  const db = await connectDB();

  return db
    .collection<TriageCall>("triage_calls")
    .updateOne(
      { callId },

      {
        $push: {
          transcripts: {
            speaker,
            text,
            timestamp: new Date()
          }
        },

        $set: {
          updatedAt: new Date()
        }
      }
    );
}


export async function addPossibleSymptom(
  callId: string,
  symptom: string
) {
  const db = await connectDB();

  return db
    .collection<TriageCall>("triage_calls")
    .updateOne(
      { callId },

      {
        $addToSet: {
          possibleSymptoms: symptom
        },

        $set: {
          updatedAt: new Date()
        }
      }
    );
}


export async function updatePatient(
  callId: string,
  patient: Partial<PatientInfo>
) {
  const db = await connectDB();

  const updates: Record<string, unknown> = {
    updatedAt: new Date()
  };

  for (const [key, value] of Object.entries(patient)) {
    if (value !== undefined) {
      updates[`patient.${key}`] = value;
    }
  }

  return db
    .collection<TriageCall>("triage_calls")
    .updateOne(
      { callId },

      {
        $set: updates
      }
    );
}


export async function endCall(
  callId: string,
  durationSeconds: number
) {
  const db = await connectDB();

  return db
    .collection<TriageCall>("triage_calls")
    .updateOne(
      { callId },

      {
        $set: {
          status: "completed",
          durationSeconds,
          endedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );
}