/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { page: 3, totalPages: 8 } },
  empty: { label: "A single page", props: { page: 1, totalPages: 1 } },
};

export const notApplicable = ["loading", "error"];
