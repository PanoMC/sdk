import { get } from "svelte/store";
import { error as throwError } from "@sveltejs/kit";

import { goto } from "$app/navigation";

import { createTicket, getTicketCategories } from "$pano/lib/services/tickets";

import { NETWORK_ERROR } from "$pano/lib/api.util";

import TicketCreateAndDetailSidebar, {
  load as loadSidebar
} from "$pano/lib/components/sidebars/TicketCreateAndDetailSidebar.svelte";

/**
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent } = event;
    const { session } = await parent();
  const themeSettings = session.siteInfo.themeSettings;

  const onlineAdminsEnabled =
    typeof themeSettings.sidebarCarts?.onlineAdmins === "undefined"
      ? true
      : themeSettings.sidebarCarts.onlineAdmins;

  if (onlineAdminsEnabled) {
    await loadSidebar(event);
  }

  let data = {
    categories: [],
    categoryPage: 0
  };

  await getTicketCategories({
    page: data.categoryPage,
    request: event
  }).then((body) => {
    if (body.error) {
      if (body.error === "NOT_EXISTS") {
        throw throwError(404, body.error);
      }

      throw throwError(500, body.error);
    }

    data = body;
  });

  return {
    ...data,
    sidebar: onlineAdminsEnabled ? TicketCreateAndDetailSidebar : null,
    pageTitle: "pages.create-ticket.title"
  };
}

export async function submit(error, loading, title, message, categoryId) {
  error.set(null);
  loading.set(true);

  await createTicket({
    title: get(title),
    message: get(message),
    categoryId: get(categoryId)
  })
    .then((body) => {
      loading.set(false);

      if (body.error) {
        error.set(body.error);

        return;
      }

      goto("/ticket/" + body.id);
    })
    .catch(() => {
      loading.set(false);

      error.set(NETWORK_ERROR);
    });
}