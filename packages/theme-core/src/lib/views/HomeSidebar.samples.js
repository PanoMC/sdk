import { items, avatarVersion, noop, SAMPLE_TIME, themeSettings } from "../../routes/catalogue/fixtures.js";

const base = (data, extra = {}) => ({
  side: "right",
  items: items([
    { id: "play-button", component: null, props: {} },
    { id: "server-info", component: null, props: {} },
    { id: "last-registrants", component: null, props: {} },
  ]),
  data: { subscribe: (run) => (run(data), () => {}) },
  themeSettings: themeSettings(),
  avatarVersion: avatarVersion(),
  serverOnline: true,
  isCommandTextCopied: false,
  onCopyCommandTextClick: noop,
  playCardIpText: "play.example.com",
  playCardIpLength: "16",
  playCardBgImage: "",
  playCardOpacity: 0.4,
  playCardBgStyle: "background: rgba(0, 0, 0, 0.5);",
  playCardBorderColor: "border-primary",
  playCardHeaderClass: "bg-primary",
  playCardIpColor: "link-light",
  playCardBtnColor: "primary",
  showPlayCardStatusBadge: true,
  showPlayCardPlayerCount: true,
  showPlayCardVersionInfo: true,
  ...extra,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: {
    props: base({
      mainServer: { status: "ONLINE", playerCount: 12, maxPlayerCount: 100 },
      serverGameVersion: "1.21",
      ipAddress: "play.example.com",
      lastRegisteredUsers: [
        { username: "Steve", lastActivityTime: SAMPLE_TIME, inGame: true },
        { username: "Alex", lastActivityTime: SAMPLE_TIME, inGame: false },
      ],
    }),
  },
  empty: {
    label: "Server offline, nobody registered",
    props: base(
      {
        mainServer: { status: "OFFLINE", playerCount: 0, maxPlayerCount: 0 },
        serverGameVersion: "",
        ipAddress: "",
        lastRegisteredUsers: [],
      },
      { serverOnline: false, items: items([]) },
    ),
  },
};

// A part: no loading or error state of its own (the controller owns the data).
export const notApplicable = ["loading", "error"];
