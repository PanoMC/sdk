import { writable } from "svelte/store";

import { asyncNoop } from "../../routes/catalogue/fixtures.js";

const props = ({ error = null, loading = false, title = "", message = "" } = {}) => ({
  data: { categories: [{ id: 1, title: "Bug report" }, { id: 2, title: "Question" }], pageTitle: "pages.create-ticket.title" },
  error: writable(error),
  title: writable(title),
  message: writable(message),
  categoryId: writable(-1),
  loading: writable(loading),
  submit: asyncNoop,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: props({ title: "Missing chest", message: "My chest keeps disappearing." }) },
  empty: { props: props() },
  error: { props: props({ error: "TITLE_TOO_SHORT", title: "x" }) },
  loading: { props: props({ loading: true, title: "Missing chest", message: "My chest keeps disappearing." }) },
};
