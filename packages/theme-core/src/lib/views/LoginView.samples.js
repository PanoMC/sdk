import { writable } from "svelte/store";

import { asyncNoop, items, noop, sessionStore } from "../../routes/catalogue/fixtures.js";

/**
 * The props of LoginView are mostly stores the controller (LoginPage) owns. A state builds fresh ones, so the
 * form in one state never shares a typed value with another.
 */
function props({ viewState = "LOGIN", error = null, loading = false, passwordVisible = false, ...rest } = {}) {
  return {
    data: { initialError: null, pageTitle: "components.modals.login.title" },
    session: sessionStore(),
    contentItems: items([{ id: "login-form" }]),
    altMethods: items([]),
    viewState: writable(viewState),
    usernameOrEmail: writable(""),
    password: writable(""),
    email: writable(""),
    passwordRepeat: writable(""),
    agreement: writable(false),
    newUsername: writable(""),
    linkCode: writable(""),
    loading: writable(loading),
    error: writable(error),
    passwordVisible: writable(passwordVisible),
    emailRequired: writable(false),
    emailVerificationSent: writable(false),
    autoVerifyDone: writable(false),
    usernameRequiredUserId: writable(null),
    onSubmit: noop,
    onVerifyLink: asyncNoop,
    onCompleteRegister: asyncNoop,
    onUsernameOrEmailFieldInput: noop,
    onRegisterEmailFieldInput: noop,
    onNewUsernameFieldInput: noop,
    ...rest,
  };
}

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { session: "guest", props: props() },
  password: { label: "Password step", session: "guest", props: props({ passwordVisible: true }) },
  error: { session: "guest", props: props({ passwordVisible: true, error: "INVALID_CREDENTIALS" }) },
  loading: { session: "guest", props: props({ passwordVisible: true, loading: true }) },
  "link-code": { label: "Link code step", session: "guest", props: props({ viewState: "LINK_CODE" }) },
};

// The form is the page: it has no empty state.
export const notApplicable = ["empty"];
