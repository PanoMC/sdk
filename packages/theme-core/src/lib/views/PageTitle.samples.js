/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { title: "Sample title", subtitle: "A subtitle under the heading" } },
  empty: { label: "Title only", props: { title: "Sample title", subtitle: "" } },
  html: { label: "HTML title", props: { title: "A <em>formatted</em> title", html: true, subtitle: "", subtitleHtml: false } },
};

export const notApplicable = ["loading", "error"];
