const { DOCTOR_NAME, OFFICE_LOCATION } = require('./office-config');

function buildConfirmation(booking) {
  const timeZone = booking.timeZone || 'America/New_York';
  const when = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full', timeStyle: 'short', timeZone
  }).format(new Date(booking.start));
  const lines = [`Your appointment with ${DOCTOR_NAME} is confirmed for ${when} (${timeZone}).`];
  lines.push(`Location: ${OFFICE_LOCATION}`);
  return lines.join('\n');
}


module.exports = { buildConfirmation };
