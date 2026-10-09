/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { session: "guest", props: { usernameOrEmail: "", password: "", loading: false, usernameDisabled: false, submitLabel: null } },
  loading: { session: "guest", props: { usernameOrEmail: "SampleUser", password: "secret", loading: true, usernameDisabled: false, submitLabel: null } },
  "username-locked": { label: "Username read-only", session: "guest", props: { usernameOrEmail: "SampleUser", password: "", loading: false, usernameDisabled: true, submitLabel: null } },
};

export const notApplicable = ["empty", "error"];
