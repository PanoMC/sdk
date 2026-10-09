import { readable } from "svelte/store";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { data: {}, hidden: readable(false) } },
  hidden: { label: "Hidden while the preview loads", props: { data: {}, hidden: readable(true) } },
};

export const notApplicable = ["empty", "loading", "error"];
