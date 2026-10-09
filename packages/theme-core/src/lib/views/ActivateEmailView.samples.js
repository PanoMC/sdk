import { writable } from "svelte/store";

import { asyncNoop, items } from "../../routes/catalogue/fixtures.js";

const props = ({ error = null, loading = false, successMessage = null } = {}) => ({
  data: { token: "sample-token" },
  error: writable(error),
  successMessage: writable(successMessage),
  loading: writable(loading),
  activateContentItems: items([]),
  verifyEmail: asyncNoop,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: props() },
  error: { props: props({ error: "INVALID_LINK" }) },
  loading: { props: props({ loading: true }) },
  success: { label: "Verified", props: props({ successMessage: "VALIDATION_SUCCESSFUL" }) },
};

export const notApplicable = ["empty"];
