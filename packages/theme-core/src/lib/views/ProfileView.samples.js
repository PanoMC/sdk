import { SAMPLE_TIME, items } from "../../routes/catalogue/fixtures.js";

const rows = [{ id: "register-date" }, { id: "last-login" }];

const data = { registerDate: SAMPLE_TIME, lastLoginDate: String(Number(SAMPLE_TIME) + 86400000), pageTitle: "pages.profile.title", sidebar: "profile" };

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: {
    session: "user",
    props: { data, contentItems: items([{ id: "profile-card" }]), cardRowItems: items(rows) },
  },
  empty: {
    label: "No profile card (a plugin removed it)",
    session: "user",
    props: { data, contentItems: items([]), cardRowItems: items(rows) },
  },
  "custom-row": {
    label: "A plugin row in the card",
    session: "user",
    props: {
      data,
      contentItems: items([{ id: "profile-card" }]),
      cardRowItems: items([...rows, { id: "sample-plugin-row", props: { label: "Plugin row", value: "42" } }]),
    },
  },
};

export const notApplicable = ["loading", "error"];
