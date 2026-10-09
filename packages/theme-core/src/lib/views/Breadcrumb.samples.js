/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: {
    props: {
      items: [
        { label: "Home", href: "/", icon: "fa-solid fa-house" },
        { label: "Support", href: "/support" },
        { label: "Sample ticket" },
      ],
    },
  },
  empty: { label: "No trail", props: { items: [] } },
};

export const notApplicable = ["loading", "error"];
