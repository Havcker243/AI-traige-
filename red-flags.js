// CDC/WHO-derived emergency warning signs. Matched against caller speech as a
// hard override — if any of these fire, the LLM is bypassed entirely.
const RED_FLAG_PATTERNS = [
  // Cardiac / chest
  /chest pain/i,
  /chest pressure/i,
  /chest tightness/i,
  /pain (spreading|radiating) (to|into) (my |the )?(arm|jaw|back)/i,

  // Breathing
  /(can'?t|cannot|trouble|difficulty|hard time) breath(e|ing)/i,
  /short(ness)? of breath/i,
  /gasping for air/i,
  /turning blue/i,
  /blue lips/i,

  // Stroke (FAST signs)
  /face (is )?droop/i,
  /slurred speech/i,
  /can'?t (move|feel) (my |one )?(arm|leg|side)/i,
  /sudden numbness/i,
  /sudden confusion/i,
  /sudden severe headache/i,
  /worst headache of my life/i,
  /trouble (seeing|walking|balance)/i,
  /loss of balance/i,

  // Bleeding / trauma
  /severe bleeding/i,
  /bleeding (that )?won'?t stop/i,
  /heavy bleeding/i,
  /coughing up blood/i,
  /vomiting blood/i,

  // Consciousness / neuro
  /pass(ed|ing)? out/i,
  /faint(ed|ing)?/i,
  /loss of consciousness/i,
  /unresponsive/i,
  /seizure/i,
  /can'?t stay awake/i,
  /unconscious/i,

  // Allergic reaction
  /throat (is )?(swelling|closing)/i,
  /can'?t swallow/i,
  /anaphylaxis/i,
  /severe allergic reaction/i,

  // Mental health crisis
  /suicidal/i,
  /kill myself/i,
  /want to die/i,
  /end my life/i,
  /hurt myself/i,
  /self[- ]harm/i,

  // Pregnancy emergencies
  /severe abdominal pain.*(pregnant|pregnancy)/i,
  /heavy bleeding.*(pregnant|pregnancy)/i
];

const EMERGENCY_MESSAGE =
  "This sounds like it could be a medical emergency. Please hang up and call 911, or go to the nearest emergency department right now. Don't wait.";

function findRedFlag(text) {
  if (!text) return null;
  for (const pattern of RED_FLAG_PATTERNS) {
    if (pattern.test(text)) return pattern.source;
  }
  return null;
}

function checkMessagesForRedFlags(messages) {
  const userText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' \n ');

  return findRedFlag(userText);
}

module.exports = { RED_FLAG_PATTERNS, EMERGENCY_MESSAGE, findRedFlag, checkMessagesForRedFlags };
