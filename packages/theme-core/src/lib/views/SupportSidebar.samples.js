import { items } from "../../routes/catalogue/fixtures.js";

const store = (value) => ({ subscribe: (run) => (run(value), () => {}) });

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: {
    props: {
      side: "right",
      items: items([{ id: "online-admins", component: null, props: {} }]),
      data: store({ onlineAdmins: ["Notch", "Herobrine"] }),
    },
  },
  empty: {
    label: "No administrator online",
    props: {
      side: "right",
      items: items([{ id: "online-admins", component: null, props: {} }]),
      data: store({ onlineAdmins: [] }),
    },
  },
};

export const notApplicable = ["loading", "error"];
