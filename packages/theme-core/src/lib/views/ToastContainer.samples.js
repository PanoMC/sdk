import { readable } from "svelte/store";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { toasts: readable([]) } },
};

export const notApplicable = ["empty", "loading", "error"];
