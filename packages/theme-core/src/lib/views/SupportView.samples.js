import { items, sessionStore } from "../../routes/catalogue/fixtures.js";

const props = (optionIds) => ({
  data: {},
  session: sessionStore(),
  items: items([{ id: "support-options" }]),
  optionItems: items(optionIds.map((id) => ({ id }))),
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { session: "guest", props: props(["create-ticket", "send-email"]) },
  empty: { label: "No support option", session: "guest", props: props([]) },
};

export const notApplicable = ["loading", "error"];
