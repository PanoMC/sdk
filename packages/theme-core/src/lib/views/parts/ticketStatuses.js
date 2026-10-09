// The ticket status names. Kept in a plain module so the TicketStatus controller can re-export
// them and the TicketRow / TicketStatus parts can read them without importing each other.
export const TicketStatuses = Object.freeze({
  NEW: "NEW",
  REPLIED: "REPLIED",
  CLOSED: "CLOSED",
});
