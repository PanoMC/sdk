/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { id: 1, variant: null, variantClass: "" } },
  success: { props: { id: 2, variant: "success", variantClass: "text-success" } },
  danger: { props: { id: 3, variant: "danger", variantClass: "text-danger" } },
  warning: { props: { id: 4, variant: "warning", variantClass: "text-warning" } },
};

export const notApplicable = ["empty", "loading", "error"];
