import { avatarVersion, post, themeSettings } from "../../routes/catalogue/fixtures.js";

const props = (extra = {}) => {
  const value = post(1, { category: { title: "News", url: "news" }, ...extra });

  return {
    data: { post: value, previousPost: "-", nextPost: "-" },
    post: value,
    themeSettings: { postCoverImageEnabled: true, postViewCountEnabled: true, ...themeSettings() },
    avatarVersion: avatarVersion(),
  };
};

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: props() },
  cover: { label: "With a cover image", props: props({ thumbnailUrl: "/assets/img/404.png" }) },
};

export const notApplicable = ["empty", "loading", "error"];
