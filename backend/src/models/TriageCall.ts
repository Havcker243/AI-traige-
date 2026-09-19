export interface TranscriptEntry {
  speaker: "patient" | "agent";

  text: string;

  timestamp: Date;
}

export interface PatientInfo {
  name?: string;

  phone?: string;

  age?: number;

  heightCm?: number;

  gender?: string;
}

export interface TriageCall {
  callId: string;

  status: "active" | "completed" | "failed";

  patient: PatientInfo;

  durationSeconds: number;

  transcripts: TranscriptEntry[];

  possibleSymptoms: string[];

  createdAt: Date;

  updatedAt: Date;

  endedAt?: Date;
}