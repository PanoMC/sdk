import { items, SAMPLE_TIME } from "../../routes/catalogue/fixtures.js";

const store = (value) => ({ subscribe: (run) => (run(value), () => {}) });

const player = (extra = {}) => ({
  username: "Steve",
  lastActivityTime: SAMPLE_TIME,
  inGame: true,
  permissionGroupName: "Member",
  banned: false,
  ...extra,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: {
    props: {
      side: "left",
      items: items([{ id: "player-info", component: null, props: {} }]),
      data: store(player()),
      checkTime: 0,
    },
  },
  empty: {
    label: "No cards",
    props: {
      side: "left",
      items: items([]),
      data: store(player({ inGame: false, banned: true, permissionGroupName: "" })),
      checkTime: 0,
    },
  },
};

export const notApplicable = ["loading", "error"];
