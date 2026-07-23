import { sendVerifyEmail } from "$pano/lib/services/auth";

import { NETWORK_ERROR } from "$pano/lib/api.util";
import { executeLifecycle, executeViewLoad } from "$pano/lib/PluginAPI";

/**
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent, url: { searchParams } } = event;
  await parent();

  const token = searchParams.get("token") || "";

  await executeLifecycle("theme:activate:load", { token }, event);
  await executeViewLoad("activate-content", event);

  return { token, pageTitle: "pages.activate.title" };
}

export async function verifyEmail(error, successMessage, loading, data) {
  error.set(null);
  successMessage.set(null);
  loading.set(true);

  await sendVerifyEmail(data.token)
    .then((body) => {
      loading.set(false);

      if (body.result === "ok") {
        successMessage.set("VALIDATION_SUCCESSFUL");
      } else {
        if (body.error === "PLUGIN_DENIED_LOGIN" && body.reason) {
          error.set(body.reason);
        } else {
          error.set(body.error);
        }
      }
    })
    .catch(() => {
      loading.set(false);

      error.set(NETWORK_ERROR);
    });
}