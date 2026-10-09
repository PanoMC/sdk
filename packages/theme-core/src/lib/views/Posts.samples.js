import { posts } from "../../routes/catalogue/fixtures.js";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { posts: posts(3) } },
  empty: { props: { posts: [] } },
};

export const notApplicable = ["loading", "error"];
