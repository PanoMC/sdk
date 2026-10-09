/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { id: 1, text: "toasts.saved", message: "Saved.", variant: "success" } },
  error: { props: { id: 2, text: "toasts.failed", message: "Something went wrong.", variant: "danger" } },
};

export const notApplicable = ["empty", "loading"];
