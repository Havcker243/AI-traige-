import { extractPatientInfo } from "./extractPatientInfo";

import {
  addTranscript,
  addPossibleSymptom,
  updatePatient
} from "../db/triage";

export async function handlePatientTranscript(
  callId: string,
  text: string
) {
  // guardar transcript original
  await addTranscript(
    callId,
    "patient",
    text
  );

  // más tarde esto usará OpenAI
  const extracted = await extractPatientInfo(text);

  await updatePatient(callId, {
    name: extracted.name,
    age: extracted.age,
    heightCm: extracted.heightCm,
    gender: extracted.gender
  });

  for (const symptom of extracted.possibleSymptoms ?? []) {
    await addPossibleSymptom(
      callId,
      symptom
    );
  }
}