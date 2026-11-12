import { error } from "@sveltejs/kit";
import { onMount } from "svelte";
import { get, writable } from "svelte/store";
import { locale } from "svelte-i18n";

import { goto } from "$app/navigation";

import { buildQueryParams } from "$pano/lib/api.util";
import { executeLifecycle, executeViewLoad, panoApiServer } from "$pano/lib/PluginAPI";

import { getTickets } from "$pano/lib/services/tickets";
import { onTicketChanged } from "$pano/lib/siteRealtime.js";
import { localized } from "$pano/lib/contentI18n.js";

import { TicketStatuses } from "$pano/lib/components/TicketStatus.svelte";
import ProfileSidebar, { load as loadSidebar } from "$pano/lib/components/sidebars/ProfileSidebar.svelte";

import {
  onHide as setCloseTicketConfirmOnHideCallback,
  setCallback as setCloseTicketConfirmCallback,
  show as showCloseTicketConfirmModal
} from "$pano/lib/components/modals/CloseTicketConfirmModal.svelte";

export const PageTypes = Object.freeze({
  ALL: "ALL",
  CLOSED: "CLOSED"
});

export const DefaultPageType = PageTypes.ALL;

/**
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent, url: { searchParams } } = event;
  await parent();

  const page = parseInt(searchParams.get("page")) || 1;
  const pageType = searchParams.get("pageType") || DefaultPageType;
  const categoryUrl = searchParams.get("category");

  const data = await getTickets({
    page,
    pageType,
    categoryUrl,
    request: event
  });

  if (data.error) {
    const code = data.error.code;

    if (code === "PAGE_NOT_FOUND" || code === "NOT_EXISTS" || code === "BAD_REQUEST") {
      throw error(404, code);
    }

    throw error(500, code);
  }

  data.pageType = pageType;
  data.categoryUrl = categoryUrl;

  // Initialize tickets content
  panoApiServer.ui.tickets.content.edit((items) => {
    items.push({ id: "tickets-card", priority: 100, hidden: false });
  });

  await executeLifecycle("theme:tickets:load", {}, event);
  await executeViewLoad("tickets-content", event);

  await loadSidebar(event);

  data.pageTitle = ticketsPageTitle(data, get(locale));

  return { ...data, sidebar: ProfileSidebar, sidebarProps: { showCreateTicket: true } };
}

/**
 * The page title of the tickets list; a category filter names the category in the given locale.
 *
 * @param {{ categoryUrl?: string | null, category?: { title?: string, i18n?: object } | null }} data
 * @param {string | null | undefined} code  svelte-i18n locale
 */
export function ticketsPageTitle(data, code) {
  const categoryUrl = data.categoryUrl;

  return {
    title: categoryUrl ? "pages.category-tickets.title" : "pages.tickets.title",
    titleValues: categoryUrl ? {
      categoryName: `"${data.category?.title === "-"
        ? data.category.title
        : localized(data.category?.title, data.category?.i18n, code, "title")}"`
    } : null
  };
}

async function refreshData(data) {
  const queryParams = buildQueryParams({
    page: data.page,
    pageType: data.pageType,
    category: data.categoryUrl
  });

  await goto(queryParams, { refreshAll: true });
}

export async function onPageClick(data, page) {
  data.page = page;

  await refreshData(data);
}

export const onCloseTicketClick = (tickets, updatedTicket) => {
  tickets.update(tickets => {
    tickets.forEach((ticket) => {
      if (ticket.id === updatedTicket.id) {
        ticket.selected = true;
      }
    });
    return tickets;
  });

  showCloseTicketConfirmModal(updatedTicket);
};

/** A burst of changes (several tickets closed at once) is read once. */
const LIVE_REFRESH_DELAY_MS = 300;

/** Reads the open page of the list again (a ticket changed on the server) and keeps the selection. */
export async function refreshTickets(tickets, data) {
  const body = await getTickets({ page: data.page, pageType: data.pageType, categoryUrl: data.categoryUrl });

  if (!body || body.error || !Array.isArray(body.tickets)) return;

  tickets.update((current) => {
    const selected = new Set(current.filter((ticket) => ticket.selected).map((ticket) => ticket.id));

    return body.tickets.map((ticket) => ({ ...ticket, selected: selected.has(ticket.id) }));
  });
}

export function init(data) {
  const tickets = writable(data.tickets);

  onMount(() => {
    let timer;

    // a staff reply or a ticket closed in the panel updates the list without a reload
    const stop = onTicketChanged(null, () => {
      clearTimeout(timer);
      timer = setTimeout(() => refreshTickets(tickets, data), LIVE_REFRESH_DELAY_MS);
    });

    return () => {
      clearTimeout(timer);
      stop();
    };
  });

  setCloseTicketConfirmCallback((updatedTicket) => {
    tickets.update(tickets => {
      tickets.forEach((ticket) => {
        if (ticket.id === updatedTicket.id) {
          ticket.status = TicketStatuses.CLOSED;
          ticket.selected = false;
        }
      });
      return tickets;
    });
  });

  setCloseTicketConfirmOnHideCallback(() => {
    tickets.update(tickets => {
      tickets.forEach((ticket) => {
        if (ticket.selected) {
          ticket.selected = false;
        }
      });
      return tickets;
    });
  });

  return { tickets };
}