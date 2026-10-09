import { noop, tickets } from "../../routes/catalogue/fixtures.js";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { tickets: tickets(), onCloseTicketClick: noop } },
  empty: { props: { tickets: [], onCloseTicketClick: noop } },
};

export const notApplicable = ["loading", "error"];
