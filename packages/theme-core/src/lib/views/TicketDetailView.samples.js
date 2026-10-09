import { readable, writable } from "svelte/store";

import { SAMPLE_TIME, asyncNoop, avatarVersion } from "../../routes/catalogue/fixtures.js";

const messages = [
  { id: 1, username: "SampleUser", panel: false, message: "My chest keeps disappearing, can you look into it?", date: SAMPLE_TIME },
  { id: 2, username: "Staff", panel: true, message: "<p>Thanks, we are checking the logs.</p>", date: String(Number(SAMPLE_TIME) + 3600000) },
];

const props = ({ status = "REPLIED", list = messages, sending = false, count = list.length } = {}) => ({
  data: { ticket: {}, messages: list },
  ticket: readable({ id: 7, title: "Missing chest", category: { title: "-", url: "-" }, status, date: SAMPLE_TIME, messageCount: count }),
  messages: writable(list),
  message: writable(""),
  messageSendLoading: writable(sending),
  messagesSectionDiv: writable(null),
  loadMoreLoading: writable(false),
  shouldScroll: writable(false),
  sentMessageCount: writable(0),
  avatarVersion: avatarVersion(),
  loadMore: asyncNoop,
  sendMessage: asyncNoop,
});

/** @type {import("../../routes/catalogue/model.js").Samples} */
export default {
  filled: { props: props() },
  empty: { label: "Ticket without messages", props: props({ list: [], count: 0, status: "NEW" }) },
  loading: { label: "Sending a reply", props: props({ sending: true }) },
  closed: { label: "Closed ticket", props: props({ status: "CLOSED" }) },
  "load-more": { label: "Older messages available", props: props({ count: 12 }) },
};

export const notApplicable = ["error"];
