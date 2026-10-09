import { writable } from "svelte/store";

import { asyncNoop, items } from "../../routes/catalogue/fixtures.js";

const props = ({ error = null, loading = false, message = null } = {}) => ({
  data: {},
  error: writable(error),
  message: writable(message),
  loading: writable(loading),
  usernameOrEmail: writable(""),
  resetPasswordContentItems: items([]),
  onSubmit: asyncNoop,
  stripIdentifierWhitespace: (value) => String(value ?? "").replace(/\s/g, ""),
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: props() },
  error: { props: props({ error: "USER_NOT_FOUND" }) },
  loading: { props: props({ loading: true }) },
  success: { label: "Link sent", props: props({ message: "RESET_LINK_SENT" }) },
};

export const notApplicable = ["empty"];
