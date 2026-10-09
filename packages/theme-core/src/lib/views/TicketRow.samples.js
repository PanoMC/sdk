import { noop, ticket } from "../../routes/catalogue/fixtures.js";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { ticket: ticket(1, "NEW"), onCloseTicket: noop } },
  replied: { props: { ticket: ticket(2, "REPLIED"), onCloseTicket: noop } },
  closed: { props: { ticket: ticket(3, "CLOSED"), onCloseTicket: noop } },
};

export const notApplicable = ["empty", "loading", "error"];
