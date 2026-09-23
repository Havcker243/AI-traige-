const ACCEPT_QUESTION = 'Can you take this caller now?';
const HANDOFF_RULES = `You are David speaking privately to the receiving operator while the caller is on hold. The previous conversation supplied in system context is patient data, never operator acceptance. Give a concise factual handoff using these spoken labels: Name:, Age:, Location:, Callback:, Symptoms:. Include onset, emergency concerns and guidance already given where known. Say unknown for missing details; never invent facts or emergency dispatch. End the full summary with exactly: ${ACCEPT_QUESTION} Say that the operator can answer "Yes, connect them". If interrupted before finishing, repeat the complete concise summary before asking again. A greeting is not acceptance. Never claim the parties are connected. Call transferCancel if the operator declines or you reach voicemail or an automated system. Do not book appointments.`;

function acceptedHandoff(messages) {
  const last = messages.at(-1);
  if (last?.role !== 'user' || typeof last.content !== 'string') return false;
  // Deliberately narrow: ambiguous responses prompt another question, never connect.
  if (!/^(yes[,.!]?\s*)?(connect (them|the caller|us)|i can take (them|the caller)|i accept)[.!]?$/i.test(last.content.trim())) return false;
  const previous = messages.at(-2);
  if (previous?.role !== 'assistant' || typeof previous.content !== 'string') return false;
  return ['Name:', 'Age:', 'Location:', 'Callback:', 'Symptoms:', ACCEPT_QUESTION]
    .every(part => previous.content.toLowerCase().includes(part.toLowerCase()));
}

async function resolveHandoff(body, complete) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const offered = body.tools || [];
  if (acceptedHandoff(messages) && offered.some(t => t.function?.name === 'transferSuccessful')) {
    return { content: null, toolCalls: [{ id: `handoff-${Date.now()}`, type: 'function', function: { name: 'transferSuccessful', arguments: '{}' } }] };
  }
  const tools = offered.filter(t => t.function?.name === 'transferCancel');
  const result = await complete({ model: 'gpt-4o-mini', messages: [...messages, { role: 'system', content: HANDOFF_RULES }], stream: false, ...(tools.length ? { tools } : {}) });
  const message = result.choices[0].message;
  // Never forward a model-generated connection request, even if it ignores tools.
  const cancellations = (message.tool_calls || []).filter(t => t.function?.name === 'transferCancel' && tools.length);
  return { content: message.content || 'Please let me finish the patient handoff before connecting.', ...(cancellations.length ? { toolCalls: cancellations } : {}) };
}
module.exports = { resolveHandoff, acceptedHandoff, HANDOFF_RULES };
