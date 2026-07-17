import { afterUpdate, onMount } from "svelte";
import { get, writable } from "svelte/store";
import { error } from "@sveltejs/kit";

import { getTicketDetail, loadMoreTicketMessages, sendTicketMessage } from "$pano/lib/services/tickets";

import TicketCreateAndDetailSidebar, {
  load as loadSidebar,
  update as updateSidebar
} from "$pano/lib/components/sidebars/TicketCreateAndDetailSidebar.svelte";

import { setCallback as setCloseTicketConfirmCallback } from "$pano/lib/components/modals/CloseTicketConfirmModal.svelte";

import { TicketStatuses } from "$pano/lib/components/TicketStatus.svelte";

/**
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent } = event;
  await parent();

  let data = {
    ticket: {
      id: -1,
      username: "",
      title: "",
      category: "-",
      messages: [],
      status: 1,
      date: 0,
      messageCount: 0
    }
  };

  await getTicketDetail({
    id: event.params.id,
    request: event
  }).then((body) => {
    if (body.error) {
      if (body.error === "NOT_EXISTS" || body.error === "BAD_REQUEST") {
        throw error(404, body.error);
      }

      throw error(500, body.error);
    }

    data = body;
  });

  await loadSidebar(event, data.ticket);

  data.pageTitle = {
    title: "pages.ticket-detail.tab-title",
    titleValues: {
      ticketId: `#${data.ticket.id}`,
      title: data.ticket.title,
    },
  };

  return { ...data, sidebar: TicketCreateAndDetailSidebar };
}

export async function loadMore(loadMoreLoading, messages, data) {
  loadMoreLoading.set(true);

  await loadMoreTicketMessages({
    id: data.ticket.id,
    lastMessageId: get(messages)[0].id
  }).then((body) => {
    if (body.error) {
      return;
    }

    body.messages.reverse().forEach((message) => {
      messages.update(messages => {
        messages.unshift(message);

        return messages;
      });
    });

    loadMoreLoading.set(false);
  });
}

export async function sendMessage(messageSendLoading, sentMessageCount, shouldScroll, messages, message, data) {
  messageSendLoading.set(true);

  await sendTicketMessage({
    ticketId: data.ticket.id,
    message: get(message)
  }).then((body) => {
    if (body.error) {
      return;
    }

    shouldScroll.set(true);

    messages.update(messages => {
      messages.push(body.message);

      return messages;
    });

    sentMessageCount.update(sentMessageCount => {
      sentMessageCount++;
      return sentMessageCount;
    });


    message.set("");

    messageSendLoading.set(false);
  });
}

export function init(data) {
  const shouldScroll = writable(true);
  const message = writable("");
  const messages = writable(data.ticket.messages);

  const messagesSectionDiv = writable();
  const loadMoreLoading = writable(false);
  const messageSendLoading = writable(false);

  const sentMessageCount = writable(0);
  const ticket = writable(data.ticket);

  afterUpdate(() => {
    if (get(shouldScroll) && get(messagesSectionDiv).scrollHeight > 0) {
      get(messagesSectionDiv).scrollTo(0, get(messagesSectionDiv).scrollHeight);

      shouldScroll.set(false);
    }
  });

  onMount(() => {
    shouldScroll.set(true);
  });

  setCloseTicketConfirmCallback(() => {
    ticket.update(ticket => {
      ticket.status = TicketStatuses.CLOSED;
      return ticket;
    });
    updateSidebar(get(ticket));
  });

  return {
    shouldScroll,
    message,
    messagesSectionDiv,
    loadMoreLoading,
    messageSendLoading,
    sentMessageCount,
    messages,
    ticket
  };
}
