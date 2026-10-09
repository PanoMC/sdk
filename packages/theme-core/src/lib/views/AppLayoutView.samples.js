import { readable } from "svelte/store";

import { sessionStore } from "../../routes/catalogue/fixtures.js";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: {
    props: {
      data: {},
      session: sessionStore(),
      pageTitle: readable("pages.profile.title"),
      getTitle: (pageTitle, siteName) => (pageTitle ? `${pageTitle} - ${siteName}` : siteName),
    },
  },
};

export const notApplicable = ["empty", "loading", "error"];
