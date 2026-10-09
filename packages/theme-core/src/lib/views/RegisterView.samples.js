import { writable } from "svelte/store";

import { asyncNoop, items } from "../../routes/catalogue/fixtures.js";

const props = ({ error = null, loading = false, successMessage = null } = {}) => ({
  data: { initialError: null, initialUsername: "", pageTitle: "components.modals.register.title" },
  contentItems: items([{ id: "register-form" }]),
  altMethods: items([]),
  onSubmit: asyncNoop,
  loading: writable(loading),
  error: writable(error),
  successMessage: writable(successMessage),
  username: writable(""),
  email: writable(""),
  password: writable(""),
  passwordRepeat: writable(""),
  agreement: writable(false),
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { session: "guest", props: props() },
  error: { session: "guest", props: props({ error: "USERNAME_ALREADY_EXISTS" }) },
  loading: { session: "guest", props: props({ loading: true }) },
  success: { label: "Registered", session: "guest", props: props({ successMessage: "REGISTER_SUCCESSFUL" }) },
};

export const notApplicable = ["empty"];
