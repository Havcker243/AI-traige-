import { connectDB } from "./db/mongo";

async function seed() {
  const db = await connectDB();

  const calls = db.collection("triage_calls");

  await calls.deleteMany({
    callId: { $regex: "^demo_" }
  });

  await calls.insertMany([
    {
      callId: "demo_001",
      status: "completed",

      patient: {
        name: "Alex Morgan",
        phone: "+16175550101",
        age: 24,
        height_ft: "5'8",
        gender: "female"
      },

      durationSeconds: 92,

      transcripts: [
        {
          speaker: "patient",
          text: "I've been feeling dizzy since this morning.",
          timestamp: new Date()
        },
        {
          speaker: "agent",
          text: "When did the dizziness begin?",
          timestamp: new Date()
        }
      ],

      possibleSymptoms: ["dizziness"],

      createdAt: new Date(),
      updatedAt: new Date(),
      endedAt: new Date()
    },

    {
      callId: "demo_002",
      status: "completed",

      patient: {
        name: "Jordan Lee",
        phone: "+16175550102",
        age: 32,
        height_ft: "6'0",
        gender: "male"
      },

      durationSeconds: 136,

      transcripts: [
        {
          speaker: "patient",
          text: "My throat has been sore for two days.",
          timestamp: new Date()
        },
        {
          speaker: "agent",
          text: "How severe is the discomfort?",
          timestamp: new Date()
        }
      ],

      possibleSymptoms: ["sore throat"],

      createdAt: new Date(),
      updatedAt: new Date(),
      endedAt: new Date()
    }
  ]);

  console.log("✅ Dummy calls inserted");
  console.log("✅ Database:", db.databaseName);

  process.exit(0);
}

seed().catch((error) => {
  console.error("❌ Seed failed:", error);
  process.exit(1);
});