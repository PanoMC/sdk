<svelte:component
  this={data.View}
  {data}
  {session}
  {contentItems}
  {cardRowItems}
  {Languages}
  {resetPasswordError}
  {resetPasswordLoading}
  {resetPasswordSuccess}
  {currentPassword}
  {newEmail}
  {changingEmail}
  {changingEmail2ndStep}
  {changingEmailError}
  {changingEmailLoading}
  {changingEmailSuccess}
  {userLocale}
  {loadingSessionId}
  {saveButtonVisible}
  {saveButtonDisabled}
  {sendResetPasswordLink}
  {sendChangeEmailLink}
  {startChangingEmail}
  {startChangingEmail2ndStep}
  {stopChangingEmail}
  {stopChangingEmail2ndStep}
  {onLogoutSession}
  {registerPlugin}
  {handleSave}
  {logout}
  {showToast}
  {invalidateAll}
  {parseUserAgent}
  {stripIdentifierWhitespace} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/SettingsPageLogics";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "SettingsView",
      () => import("../../views/SettingsView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
  }
</script>

<script>
  import { getContext } from "svelte";
  import { derived, writable } from "svelte/store";
  import { invalidateAll } from "$app/navigation";
  import { parseUserAgent } from "$pano/lib/string.util";

  import { show as showToast } from "$pano/lib/components/ToastContainer.svelte";

  import {
    init,
    sendChangeEmailLink,
    sendResetPasswordLink,
    startChangingEmail,
    startChangingEmail2ndStep,
    stopChangingEmail,
    stopChangingEmail2ndStep,
    saveSettings,
    onLogoutSession,
  } from "$pano/lib/ui-logics/page-logics/SettingsPageLogics";

  import { Languages, currentLanguage } from "$pano/lib/language.util";
  import { stripIdentifierWhitespace } from "$pano/lib/loginInput.util.js";
  import { logout } from "$pano/lib/Store";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";

  export let data;

  const session = getContext("session");

  const contentItems = panoApiClient.ui.settings.content.get();
  const cardRowItems = panoApiClient.ui.settings.cardRows.get();

  const {
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
    loadingSessionId,
  } = init($session);

  let pluginStates = {};
  const totalDirtyPlugins = writable(0);
  const totalSaveablePlugins = writable(0);

  function registerPlugin(id, state) {
    if (!state) {
      delete pluginStates[id];
    } else {
      pluginStates[id] = state;
    }
    updateTotals();
  }

  function updateTotals() {
    totalDirtyPlugins.set(
      Object.values(pluginStates).filter((s) => s.isDirty).length,
    );
    totalSaveablePlugins.set(Object.keys(pluginStates).length);
  }

  async function handleSave() {
    if ($saveButtonDisabled) return;

    // 1. Save locale if changed
    if ($userLocale !== $currentLanguage.code) {
      await saveSettings(userLocale, saveButtonLoading);
    }

    // 2. Save plugins
    const savePromises = Object.values(pluginStates)
      .filter((state) => state.isDirty && state.save)
      .map((state) => state.save());

    if (savePromises.length > 0) {
      saveButtonLoading.set(true);
      try {
        await Promise.all(savePromises);
      } catch (e) {
        console.error("Failed to save some plugins", e);
      } finally {
        saveButtonLoading.set(false);
        updateTotals();
      }
    }
  }

  const saveButtonVisible = derived(
    [session, totalSaveablePlugins],
    ([currentSession, saveablePlugins]) =>
      currentSession.siteInfo.allowUserLocaleSelection || saveablePlugins > 0,
  );
  const saveButtonDisabled = derived(
    [userLocale, currentLanguage, totalDirtyPlugins, saveButtonLoading],
    ([locale, language, dirtyPlugins, saving]) =>
      (locale === language.code && dirtyPlugins === 0) || saving,
  );
</script>
