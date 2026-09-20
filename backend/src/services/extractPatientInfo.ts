export interface ExtractedInfo {
  name?: string;
  age?: number;
  heightCm?: number;
  gender?: string;
  possibleSymptoms?: string[];
}

export async function extractPatientInfo(
  text: string
): Promise<ExtractedInfo> {

  console.log("Transcript received for extraction:", text);

  return {};
}