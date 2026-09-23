// Shared by David and the receiving-operator handoff assistant.
function buildVoice() {
  return {
    provider: 'vapi',
    voiceId: 'Elliot'
  };
}

module.exports = { buildVoice };
