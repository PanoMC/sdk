/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { side: "right" } },
  left: { label: "Left side", props: { side: "left" } },
};

export const notApplicable = ["empty", "loading", "error"];
