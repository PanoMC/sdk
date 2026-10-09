/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { session: "guest", props: { username: "", email: "", password: "", passwordRepeat: "", agreement: false, loading: false, usernameDisabled: false } },
  loading: { session: "guest", props: { username: "SampleUser", email: "sample@example.com", password: "secret", passwordRepeat: "secret", agreement: true, loading: true, usernameDisabled: false } },
};

export const notApplicable = ["empty", "error"];
