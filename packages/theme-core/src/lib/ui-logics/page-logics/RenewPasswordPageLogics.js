import { get } from "svelte/store";

import { sendRenewPassword } from "$pano/lib/services/auth";
import { NETWORK_ERROR } from "$pano/lib/api.util";
import { executeLifecycle, executeViewLoad } from "$pano/lib/PluginAPI";

export async function processLoad(event) {
  const { parent, url: { searchParams } } = event;
  await parent();

  const token = searchParams.get("token") || "";

  await executeLifecycle("theme:renew-password:load", { token }, event);
  await executeViewLoad("renew-password-content", event);

  return { token, pageTitle: "pages.renew-password.title" };
}

export async function onSubmit(error, message, loading, newPassword, newPasswordRepeat, data) {
  error.set(null);
  message.set(null);
  loading.set(true);

  await sendRenewPassword(get(newPassword), get(newPasswordRepeat), data.token)
    .then((body) => {
      loading.set(false);

      if (body.result === "ok") {
        message.set("RENEW_PASSWORD_SUCCESSFUL");

        return;
      }

      if (body.error === "PLUGIN_DENIED_LOGIN" && body.reason) {
        error.set(body.reason);
      } else {
        error.set(body.error);
      }
    })
    .catch(() => {
      error.set(NETWORK_ERROR);
      loading.set(false);
    });
}