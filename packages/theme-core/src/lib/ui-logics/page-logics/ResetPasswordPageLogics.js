import { get } from "svelte/store";

import { NETWORK_ERROR } from "$pano/lib/api.util";
import { executeLifecycle, executeViewLoad } from "$pano/lib/PluginAPI";
import { sendResetPassword } from "$pano/lib/services/auth";
import { requireNotLogin } from "$pano/lib/Store";

export async function processLoad(event) {
  const { parent } = event;
  const parentData = await parent();

  const { session } = parentData;

  requireNotLogin(session, event);

  await executeLifecycle("theme:reset-password:load", {}, event);
  await executeViewLoad("reset-password-content", event);

  return { pageTitle: "pages.reset-password.title" };
}

export async function onSubmit(error, message, loading, usernameOrEmail) {
  error.set(null);
  message.set(null);
  loading.set(true);

  await sendResetPassword(get(usernameOrEmail))
    .then((body) => {
      loading.set(false);

      if (!body.error) {
        message.set("RESET_PASSWORD_SUCCESSFUL");

        return;
      }

      if (body.error.code === "NOT_EXISTS") {
        message.set("RESET_PASSWORD_SUCCESSFUL");

        return;
      }

      if (body.error.code === "PLUGIN_DENIED_LOGIN" && body.error.details?.reason) {
        error.set(body.error.details.reason);
      } else {
        error.set(body.error.code);
      }
    })
    .catch(() => {
      error.set(NETWORK_ERROR);
      loading.set(false);
    });
}