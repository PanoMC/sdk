import { SAMPLE_TIME } from "../../routes/catalogue/fixtures.js";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { time: SAMPLE_TIME, relativeFormat: false } },
  relative: { label: "Relative format", props: { time: SAMPLE_TIME, relativeFormat: true } },
};

export const notApplicable = ["empty", "loading", "error"];
