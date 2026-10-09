import { avatarVersion, post, themeSettings } from "../../routes/catalogue/fixtures.js";

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { post: post(1), detail: false, themeSettings: themeSettings(), avatarVersion: avatarVersion() } },
  cover: { label: "With a cover image", props: { post: post(2, { thumbnailUrl: "/assets/img/404.png" }), detail: false, themeSettings: themeSettings(), avatarVersion: avatarVersion() } },
  detail: { label: "Detail (full text)", props: { post: post(3), detail: true, themeSettings: themeSettings(), avatarVersion: avatarVersion() } },
};

export const notApplicable = ["empty", "loading", "error"];
