import { readable } from "svelte/store";

import { noop } from "../../routes/catalogue/fixtures.js";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { dialogID: "sample-modal", error: readable(null), loading: false, hide: noop, onYesClick: noop } },
  error: { props: { dialogID: "sample-modal", error: readable("TICKET_NOT_FOUND"), loading: false, hide: noop, onYesClick: noop } },
  loading: { props: { dialogID: "sample-modal", error: readable(null), loading: true, hide: noop, onYesClick: noop } },
};

export const notApplicable = ["empty"];
