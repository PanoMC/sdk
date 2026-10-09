import { SAMPLE_TIME } from "../../routes/catalogue/fixtures.js";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { data: { registerDate: SAMPLE_TIME } } },
};

export const notApplicable = ["empty", "loading", "error"];
