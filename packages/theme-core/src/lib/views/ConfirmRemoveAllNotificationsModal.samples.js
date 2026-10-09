import { noop } from "../../routes/catalogue/fixtures.js";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { dialogID: "sample-modal", loading: false, hide: noop, onYesClick: noop } },
  loading: { props: { dialogID: "sample-modal", loading: true, hide: noop, onYesClick: noop } },
};

export const notApplicable = ["empty", "error"];
