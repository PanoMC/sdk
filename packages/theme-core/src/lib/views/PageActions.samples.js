/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { leftClasses: "", middleClasses: "", rightClasses: "" } },
  empty: { label: "No columns", props: { leftClasses: null, middleClasses: null, rightClasses: null } },
};

export const notApplicable = ["loading", "error"];
