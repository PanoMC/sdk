/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { label: "404", props: { page: { status: 404, error: { message: "Not found" } } } },
  error: { label: "Internal error", props: { page: { status: 500, error: { message: "Internal Error" } } } },
  "assets-failed": { label: "A chunk failed to load", props: { page: { status: 500, error: { code: "MODULE_LOAD_FAILED" } } } },
};

export const notApplicable = ["empty", "loading"];
