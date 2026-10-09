import { writable } from "svelte/store";

import { asyncNoop, items } from "../../routes/catalogue/fixtures.js";

const props = ({ error = null, loading = false, message = null } = {}) => ({
  data: { token: "sample-token" },
  error: writable(error),
  message: writable(message),
  loading: writable(loading),
  newPassword: writable(""),
  newPasswordRepeat: writable(""),
  renewPasswordContentItems: items([]),
  onSubmit: asyncNoop,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: props() },
  error: { props: props({ error: "PASSWORDS_NOT_MATCH" }) },
  loading: { props: props({ loading: true }) },
  success: { label: "Password changed", props: props({ message: "PASSWORD_CHANGED" }) },
};

export const notApplicable = ["empty"];
