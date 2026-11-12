import { get } from "svelte/store";
import { error as throwError } from "@sveltejs/kit";

import { goto } from "$app/navigation";

import { createTicket, getTicketCategories } from "$pano/lib/services/tickets";
import { fieldErrorsFromServer, prepareFieldValues } from "$pano/lib/ticketFields.js";

import { NETWORK_ERROR } from "$pano/lib/api.util";
import { showSuccess as showSuccessToast } from "$pano/lib/components/ToastContainer.svelte";

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
    categoryPage: 1
  };

  await getTicketCategories({
    page: data.categoryPage,
    request: event
  }).then((body) => {
    if (body.error) {
      if (body.error.code === "NOT_EXISTS") {
        throw throwError(404, body.error.code);
      }

      throw throwError(500, body.error.code);
    }

    data = body;
  });

  return {
    ...data,
    sidebar: onlineAdminsEnabled ? TicketCreateAndDetailSidebar : null,
    pageTitle: "pages.create-ticket.title"
  };
}

/**
 * Sends the create-ticket request. `fieldState` (optional) carries the custom fields of the chosen
 * category: `{ categories, values, errors }` (values / errors are writable stores keyed by field key).
 * Only the visible, non-empty values are sent; a client-side check failure or a server
 * `INVALID_FIELDS` answer fills `errors` and stops.
 */
export async function submit(error, loading, title, message, categoryId, fieldState) {
  error.set(null);

  let fields;

  if (fieldState) {
    const id = get(categoryId);
    const category = (fieldState.categories ?? []).find((item) => String(item.id) === String(id));
    const definitions = category?.fields ?? [];

    if (definitions.length > 0) {
      const prepared = prepareFieldValues(definitions, get(fieldState.values));

      fieldState.errors.set(prepared.errors);

      if (!prepared.valid) {
        error.set("INVALID_FIELDS");

        return;
      }

      if (Object.keys(prepared.fields).length > 0) fields = prepared.fields;
    } else {
      fieldState.errors.set({});
    }
  }

  loading.set(true);

  await createTicket({
    title: get(title),
    message: get(message),
    categoryId: get(categoryId),
    fields
  })
    .then((body) => {
      loading.set(false);

      if (body.error) {
        if (body.error.code === "INVALID_FIELDS" && fieldState) {
          fieldState.errors.set(fieldErrorsFromServer(body.error.fields));
        }

        error.set(body.error.code);

        return;
      }

      goto("/ticket/" + body.id);

      void showSuccessToast("toasts.ticket-created");
    })
    .catch(() => {
      loading.set(false);

      error.set(NETWORK_ERROR);
    });
}
