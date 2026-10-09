import { noop, posts, themeSettings } from "../../routes/catalogue/fixtures.js";

const data = (extra = {}) => ({
  posts: posts(3),
  postCount: 21,
  page: 1,
  totalPages: 7,
  category: null,
  categoryUrl: null,
  sidebar: "home",
  hookProps: {},
  ...extra,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { data: data(), themeSettings: themeSettings(), onPageClick: noop } },
  empty: { props: { data: data({ posts: [], postCount: 0, totalPages: 1 }), themeSettings: themeSettings(), onPageClick: noop } },
  category: {
    label: "Posts of a category",
    props: {
      data: data({ category: { title: "News" }, categoryUrl: "news", postCount: 3, totalPages: 1 }),
      themeSettings: themeSettings(),
      onPageClick: noop,
    },
  },
  "posts-disabled": {
    label: "Posts turned off in the theme settings",
    props: { data: data(), themeSettings: themeSettings({ postsEnabled: false }), onPageClick: noop },
  },
};

// A page: no loading or error state of its own (the controller's load runs before the view exists).
export const notApplicable = ["loading", "error"];
