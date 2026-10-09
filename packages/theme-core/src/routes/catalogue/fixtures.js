// Fixtures of the engine's sample files (`lib/views/<Name>.samples.js`, doc 02 section 7).
//
// Engine samples may build stores: several of the engine's view props are stores or functions (the
// controller hands them over, see `skin-contract.json`). Plugin samples are pure data; this file is
// the engine's own convenience and is not part of any contract.

import { readable, writable } from "svelte/store";

/** 2023-11-14, as the backend sends dates (epoch milliseconds in a string). */
export const SAMPLE_TIME = "1700000000000";

export const noop = () => {};

/** A function that does nothing and returns the value the real handler would not: samples never call the server. */
export const asyncNoop = async () => {};

export const siteInfo = {
  websiteName: "Pano Sample",
  websiteDescription: "A sample site for the view catalogue",
  serverIp: "play.example.com",
  supportEmail: "support@example.com",
  isDemo: false,
  registerEnabled: true,
};

export const sampleUser = {
  id: 1,
  username: "SampleUser",
  email: "sample@example.com",
  permissions: [],
  emailVerified: true,
};

/** The `session` context store: `{ user, csrfToken, siteInfo }`. */
export const sessionStore = (user = null) => writable({ user, csrfToken: "sample-csrf-token", siteInfo });

export const post = (n, extra = {}) => ({
  url: `sample-post-${n}`,
  title: `Sample post ${n}`,
  text: `<p>This is the text of sample post ${n}. ${"Lorem ipsum dolor sit amet. ".repeat(6)}</p>`,
  views: 40 * n,
  date: SAMPLE_TIME,
  category: { title: n % 2 ? "News" : "-", url: n % 2 ? "news" : "-" },
  writer: { username: `Writer${n}` },
  thumbnailUrl: undefined,
  ...extra,
});

export const posts = (count = 3) => Array.from({ length: count }, (_, i) => post(i + 1));

export const ticket = (n, status = "NEW", extra = {}) => ({
  id: n,
  title: `Sample ticket ${n}`,
  status,
  category: { title: n % 2 ? "-" : "Bug report", url: n % 2 ? "-" : "bug-report" },
  lastUpdate: SAMPLE_TIME,
  ...extra,
});

export const tickets = () => [ticket(1, "NEW"), ticket(2, "REPLIED"), ticket(3, "CLOSED")];

/** A store of plugin content items, as `panoApiClient.ui.*.content.get()` hands out. */
export const items = (list = []) => readable(list);

export const themeSettings = (extra = {}) => ({
  themeColor: "dark",
  postsEnabled: true,
  postCoverImageEnabled: true,
  postViewCountEnabled: true,
  postAuthorImageEnabled: true,
  postPreviousPageEnabled: true,
  postNextPageEnabled: true,
  sidebarEnabled: true,
  ...extra,
});

export const avatarVersion = () => readable("sample");
