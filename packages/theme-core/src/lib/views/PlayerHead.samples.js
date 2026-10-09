/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: { username: "SampleUser", width: 64, height: 64, checkTime: 0, inGame: false, lastActivityTime: "1700000000000", banned: false } },
  "in-game": { label: "In game", props: { username: "SampleUser", width: 64, height: 64, checkTime: 0, inGame: true, lastActivityTime: "1700000000000", banned: false } },
  banned: { props: { username: "SampleUser", width: 64, height: 64, checkTime: 0, inGame: false, lastActivityTime: "1700000000000", banned: true } },
};

export const notApplicable = ["empty", "loading", "error"];
