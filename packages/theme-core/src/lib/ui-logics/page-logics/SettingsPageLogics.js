import { get, writable } from "svelte/store";

import { sendChangeEmail, sendResetPassword, sendUpdateProfile } from "$pano/lib/services/profile";

import ApiUtil, { NETWORK_ERROR } from "$pano/lib/api.util";
import { executeLifecycle, executeViewLoad, panoApiServer } from "$pano/lib/PluginAPI";

import ProfileSidebar, { load as loadSidebar } from "$pano/lib/components/sidebars/ProfileSidebar.svelte";
import { changeLanguage, getLanguageByLocale } from "$pano/lib/language.util.js";

/**
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent } = event;
  await parent();

  // Initialize settings content
  panoApiServer.ui.settings.content.edit((items) => {
    items.push(
      { id: "settings-cards", priority: 300, hidden: false },
      { id: "sessions-card", priority: 100, hidden: false }
    );
  });

  // Initialize settings card rows
  panoApiServer.ui.settings.cardRows.edit((items) => {
    items.push(
      { id: "change-password", priority: 100, hidden: false },
      { id: "change-email", priority: 90, hidden: false },
      { id: "display-language", priority: 80, hidden: false },
    );
  });

  await executeLifecycle("theme:settings:load", {}, event);

  // View loads, sidebar, and sessions API call are all independent — run in parallel
  const [, , , sessionsBody] = await Promise.all([
    executeViewLoad("settings-content", event),
    executeViewLoad("settings-card-rows", event),
    loadSidebar(event),
    ApiUtil.get({ path: "/api/profile/sessions", request: event })
  ]);

  const sessions = !sessionsBody.error ? sessionsBody.sessions : [];

  return { sidebar: ProfileSidebar, sessions, pageTitle: "pages.settings.title" };
}

export async function sendResetPasswordLink(
  resetPasswordError,
  resetPasswordLoading,
  resetPasswordSuccess,
) {
  resetPasswordError.set(null);
  resetPasswordLoading.set(true);
  resetPasswordSuccess.set(false);

  await sendResetPassword()
    .then((body) => {
      resetPasswordLoading.set(false);

      if (body.result === "ok") {
        resetPasswordSuccess.set(true);

        return;
      }

      resetPasswordError.set(body.error || NETWORK_ERROR);
    })
    .catch(() => {
      resetPasswordLoading.set(false);
      resetPasswordError.set(NETWORK_ERROR);
    });
}

export async function sendChangeEmailLink(
  changingEmailError,
  changingEmailLoading,
  changingEmailSuccess,
  currentPassword,
  newEmail,
  changingEmail,
  changingEmail2ndStep
) {
  const next = get(newEmail);
  if (next == null || String(next).trim() === "") {
    return;
  }

  changingEmailError.set(null);
  changingEmailLoading.set(true);
  changingEmailSuccess.set(false);

  await sendChangeEmail(get(currentPassword), get(newEmail))
    .then((body) => {
      changingEmailLoading.set(false);

      if (body.result === "ok") {
        changingEmail.set(false);
        changingEmail2ndStep.set(false);

        changingEmailSuccess.set(true);

        return;
      }

      const err = body.error || NETWORK_ERROR;
      if (err === "CURRENT_PASSWORD_NOT_CORRECT") {
        changingEmail2ndStep.set(false);
      }
      changingEmailError.set(err);
    })
    .catch(() => {
      changingEmailLoading.set(false);

      changingEmailError.set(NETWORK_ERROR);
    });
}

export function startChangingEmail(changingEmail, changingEmailError) {
  changingEmailError.set(null);
  changingEmail.set(true);
}

export function startChangingEmail2ndStep(
  changingEmail2ndStep,
  currentPassword,
  changingEmailError
) {
  const pwd = get(currentPassword);
  if (pwd == null || String(pwd).trim() === "") {
    return;
  }
  changingEmailError.set(null);
  changingEmail2ndStep.set(true);
}

export function stopChangingEmail(
  currentPassword,
  newEmail,
  changingEmail,
  changingEmail2ndStep,
  changingEmailError
) {
  currentPassword.set("");
  newEmail.set("");
  changingEmailError.set(null);
  changingEmail2ndStep.set(false);
  changingEmail.set(false);
}

export function stopChangingEmail2ndStep(
  changingEmail2ndStep,
  changingEmailError
) {
  changingEmail2ndStep.set(false);
  changingEmailError.set(null);
}

export async function saveSettings(userLocale, saveButtonLoading) {
  saveButtonLoading.set(true)

  await sendUpdateProfile({ localeCode: get(userLocale) }).then((body) => {
    if (body.error) {
      location.reload();
      return;
    }

    changeLanguage(getLanguageByLocale(get(userLocale)))
    saveButtonLoading.set(false)
  }).catch(() => {
    location.reload();
  })
}

export async function onLogoutSession(sessionId, loadingSessionId, showToast, invalidateAll) {
  loadingSessionId.set(sessionId);

  ApiUtil.delete({
    path: `/api/profile/sessions/${sessionId}`,
    handler: async (body) => {
      loadingSessionId.set(null);

      if (body.error) {
        // The variant rides on `show`'s options argument rather than a separate
        // showError parameter: onLogoutSession receives the toast function from the
        // view, and widening that signature would be a breaking controller-props change.
        await showToast('errors.' + body.error, {}, undefined, { variant: 'danger' });
        return;
      }

      await showToast('toasts.session-logged-out-successful', {}, undefined, {
        variant: 'success',
      });
      invalidateAll();
    },
  });
}

export function init(session) {
  const resetPasswordError = writable();
  const resetPasswordLoading = writable();
  const resetPasswordSuccess = writable();

  const currentPassword = writable();
  const newEmail = writable();

  const changingEmail = writable();
  const changingEmail2ndStep = writable();

  const changingEmailError = writable();
  const changingEmailLoading = writable();
  const changingEmailSuccess = writable();

  const userLocale = writable(session.siteInfo.locale)
  const saveButtonLoading = writable()
  const loadingSessionId = writable(null)

  return {
    resetPasswordError,
    resetPasswordLoading,
    resetPasswordSuccess,
    currentPassword,
    newEmail,
    changingEmail,
    changingEmail2ndStep,
    changingEmailError,
    changingEmailLoading,
    changingEmailSuccess,
    userLocale,
    saveButtonLoading,
    loadingSessionId
  };
}