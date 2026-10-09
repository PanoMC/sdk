import { items, noop, ticket } from "../../routes/catalogue/fixtures.js";

const store = (value) => ({ subscribe: (run) => (run(value), () => {}) });

const cards = [
  { id: "online-admins", component: null, props: {} },
  { id: "close-ticket-button", component: null, props: {} },
];

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: {
    props: {
      side: "right",
      items: items(cards),
      data: store({ onlineAdmins: ["Notch"] }),
      ticketData: store(ticket(1, "REPLIED")),
      onCloseTicketClick: noop,
    },
  },
  empty: {
    label: "Create page: no ticket, nobody online",
    props: {
      side: "right",
      items: items(cards),
      data: store({ onlineAdmins: [] }),
      ticketData: store(null),
      onCloseTicketClick: noop,
    },
  },
};

export const notApplicable = ["loading", "error"];
