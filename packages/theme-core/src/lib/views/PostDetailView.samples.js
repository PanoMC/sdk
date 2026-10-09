import { avatarVersion, post, themeSettings } from "../../routes/catalogue/fixtures.js";

const data = (extra = {}) => ({
  post: post(1, { category: { title: "News", url: "news" } }),
  previousPost: { url: "sample-post-0", title: "The post before" },
  nextPost: { url: "sample-post-2", title: "The post after" },
  hookProps: {},
  ...extra,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { data: data(), themeSettings: themeSettings(), avatarVersion: avatarVersion() } },
  cover: {
    label: "With a cover image",
    props: {
      data: data({ post: post(2, { thumbnailUrl: "/assets/img/404.png", category: { title: "-", url: "-" } }) }),
      themeSettings: themeSettings(),
      avatarVersion: avatarVersion(),
    },
  },
  "no-neighbours": {
    label: "First and only post",
    props: { data: data({ previousPost: "-", nextPost: "-" }), themeSettings: themeSettings(), avatarVersion: avatarVersion() },
  },
};

export const notApplicable = ["empty", "loading", "error"];
