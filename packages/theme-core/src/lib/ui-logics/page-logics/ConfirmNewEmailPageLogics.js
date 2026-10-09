import { sendVerifyNewEmail } from "$pano/lib/services/auth";
import { NETWORK_ERROR } from "$pano/lib/api.util";
import { executeLifecycle, executeViewLoad } from "$pano/lib/PluginAPI";

/**
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent, url: { searchParams } } = event;
  await parent();

  const token = searchParams.get("token") || "";

  await executeLifecycle("theme:activate-new-email:load", { token }, event);
  await executeViewLoad("activate-new-email-content", event);

  return { token, pageTitle: "pages.activate-new-email.title" };
}

export async function verifyEmail(error, successMessage, loading, data) {
  error.set(null);
  successMessage.set(null);
  loading.set(true);

  await sendVerifyNewEmail(data.token)
    .then((body) => {
      loading.set(false);
      if (!body.error) {
        successMessage.set("VALIDATION_SUCCESSFUL");
      } else {
        if (body.error.code === "PLUGIN_DENIED_LOGIN" && body.error.details?.reason) {
          error.set(body.error.details.reason);
        } else {
          error.set(body.error.code);
        }
      }
    })
    .catch(() => {
      error.set(NETWORK_ERROR);
      loading.set(false);
    });
}