import { readable } from "svelte/store";

import { items, noop, tickets } from "../../routes/catalogue/fixtures.js";

const PageTypes = { ALL: "ALL", CLOSED: "CLOSED" };

const props = (list, extra = {}) => ({
  data: { pageType: "ALL", page: 1, totalPages: 3, ticketCount: list.length ? 24 : 0, category: null, categoryUrl: null, ...extra },
  contentItems: items([{ id: "tickets-card" }]),
  tickets: readable(list),
  PageTypes,
  onCloseTicketClick: noop,
  onPageClick: noop,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: props(tickets()) },
  empty: { props: props([]) },
  closed: { label: "Closed tickets", props: props(tickets().filter((t) => t.status === "CLOSED"), { pageType: "CLOSED", totalPages: 1 }) },
};

export const notApplicable = ["loading", "error"];
