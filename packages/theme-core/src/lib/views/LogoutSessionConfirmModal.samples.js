import { noop } from "../../routes/catalogue/fixtures.js";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { dialogID: "sample-modal", hide: noop, onYesClick: noop } },
};

export const notApplicable = ["empty", "loading", "error"];
