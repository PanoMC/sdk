// Header reads the theme settings and the session from the page's contexts: there are no props to give.
/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { session: "guest", props: {} },
  user: { label: "Signed in", session: "user", props: {} },
};

export const notApplicable = ["empty", "loading", "error"];
