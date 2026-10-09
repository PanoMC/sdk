/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { status: "NEW" } },
  replied: { props: { status: "REPLIED" } },
  closed: { props: { status: "CLOSED" } },
};

export const notApplicable = ["empty", "loading", "error"];
