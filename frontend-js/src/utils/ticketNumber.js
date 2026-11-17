export function formatTicketReference(value) {
  const ticketNumber = String(value || '').trim().replace(/^#+/, '');
  return `#${ticketNumber || 'UNKNOWN'}`;
}