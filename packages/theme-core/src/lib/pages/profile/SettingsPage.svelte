<!-- Settings -->
<div class="vstack gap-3">
  {#each $contentItems as item (item.id)}
    {#if item.id === "settings-cards"}
      <div class="card mt-3 mt-lg-0">
        <CardHeader>
          <div slot="left">{$_("pages.settings.title")}</div>
        </CardHeader>
        <div class="card-body">
          {#each $cardRowItems as row (row.id)}
            {#if row.id === "change-password"}
              <div class="row">
                <label class="col-md-4 col-form-label" for="resetPassword">
                  {$_("pages.settings.inputs.change-password.title")}
                </label>
                <div class="col col-form-label">
                  <button
                    class="btn btn-link"
                    class:is-invalid={$resetPasswordError}
                    onclick={() =>
                      sendResetPasswordLink(
                        resetPasswordError,
                        resetPasswordLoading,
                        resetPasswordSuccess,
                      )}
                    aria-describedby="resetPassword validationResetPassword"
                    disabled={$resetPasswordLoading || !$session.siteInfo.emailEnabled}
                    type="button"
                    >{$_("pages.settings.inputs.change-password.description")}</button>

                  <div id="validationResetPassword" class="invalid-feedback">
                    {$_("errors." + $resetPasswordError)}
                  </div>
                  {#if $resetPasswordSuccess}
                    <p class="mb-0">
                      {$_("pages.settings.inputs.change-password.success-message")}
                    </p>
                  {/if}
                </div>
              </div>
            {:else if row.id === "change-email"}
              <div class="row">
                <label class="col-md-4 col-form-label" for="userEmail">
                  {$_("pages.settings.inputs.change-email.title")}
                </label>
                <div class="col col-form-label">
                  <form
                    onsubmit={(e) => {
                      e.preventDefault();
                      if ($changingEmail2ndStep) {
                        if (!String($newEmail ?? "").trim()) {
                          return;
                        }
                        void sendChangeEmailLink(
                          changingEmailError,
                          changingEmailLoading,
                          changingEmailSuccess,
                          currentPassword,
                          newEmail,
                          changingEmail,
                          changingEmail2ndStep,
                        );
                      } else {
                        startChangingEmail2ndStep(
                          changingEmail2ndStep,
                          currentPassword,
                          changingEmailError,
                        );
                      }
                    }}>
                    <div class="row g-2 align-items-start">
                      {#if !$changingEmail}
                        <div class="col-12">
                          {#if $changingEmailSuccess}
                            <p class="text-dark mb-0">
                              {$_(
                                "pages.settings.inputs.change-email.success-message",
                                {
                                  values: { newEmail: $newEmail },
                                },
                              )}
                            </p>
                          {:else}
                            <button
                              type="button"
                              class="btn btn-link"
                              aria-describedby="userEmail"
                              onclick={() =>
                                startChangingEmail(
                                  changingEmail,
                                  changingEmailError,
                                )}
                              disabled={!$session.siteInfo.emailEnabled}
                              >{$_(
                                "pages.settings.inputs.change-email.description",
                              )}</button>
                          {/if}
                        </div>
                      {:else if $changingEmail2ndStep}
                        <div class="col-12 col-md min-w-0">
                          <input
                            type="email"
                            id="newEmail"
                            placeholder={$_(
                              "pages.settings.inputs.change-password.new-email-placeholder",
                            )}
                            class="form-control"
                            aria-describedby="validationChangingEmail"
                            bind:value={$newEmail}
                            oninput={() => {
                              const c = stripIdentifierWhitespace($newEmail);
                              if (c !== $newEmail) {
                                newEmail.set(c);
                              }
                            }}
                            class:is-invalid={$changingEmail2ndStep &&
                              $changingEmailError &&
                              $changingEmailError !==
                                "CURRENT_PASSWORD_NOT_CORRECT"}
                            autofocus />
                          <div id="validationChangingEmail" class="invalid-feedback">
                            {#if $changingEmail2ndStep && $changingEmailError && $changingEmailError !== "CURRENT_PASSWORD_NOT_CORRECT"}
                              {$_("errors." + $changingEmailError)}
                            {/if}
                          </div>
                        </div>
                        <div
                          class="col-12 col-md-auto d-flex flex-wrap gap-2 align-items-center justify-content-md-end">
                          <button
                            type="reset"
                            class="btn btn-link link-primary"
                            onclick={() =>
                              stopChangingEmail2ndStep(
                                changingEmail2ndStep,
                                changingEmailError,
                              )}>
                            {$_("pages.settings.inputs.change-email.back")}
                          </button>
                          <button
                            type="submit"
                            class="btn btn-link link-secondary"
                            class:disabled={$changingEmailLoading ||
                              !String($newEmail ?? "").trim()}
                            disabled={$changingEmailLoading ||
                              !String($newEmail ?? "").trim()}>
                            {$_("pages.settings.inputs.change-email.confirm")}
                          </button>
                        </div>
                      {:else}
                        <div class="col-12 col-md min-w-0">
                          <input
                            type="password"
                            id="currentPassword"
                            placeholder={$_(
                              "pages.settings.inputs.change-email.current-password-placeholder",
                            )}
                            class="form-control"
                            class:is-invalid={$changingEmailError ===
                              "CURRENT_PASSWORD_NOT_CORRECT"}
                            aria-describedby={$changingEmailError ===
                            "CURRENT_PASSWORD_NOT_CORRECT"
                              ? "validationCurrentPassword"
                              : undefined}
                            bind:value={$currentPassword}
                            autofocus />
                          {#if $changingEmailError === "CURRENT_PASSWORD_NOT_CORRECT"}
                            <div
                              id="validationCurrentPassword"
                              class="invalid-feedback d-block">
                              {$_("errors." + $changingEmailError)}
                            </div>
                          {/if}
                        </div>
                        <div
                          class="col-12 col-md-auto d-flex flex-wrap gap-2 align-items-center justify-content-md-end">
                          <button
                            type="reset"
                            class="btn btn-link link-danger"
                            onclick={() =>
                              stopChangingEmail(
                                currentPassword,
                                newEmail,
                                changingEmail,
                                changingEmail2ndStep,
                                changingEmailError,
                              )}>
                            {$_("pages.settings.inputs.change-email.cancel")}
                          </button>
                          <button
                            type="submit"
                            class="btn btn-link"
                            class:disabled={!String($currentPassword ?? "").trim()}
                            disabled={!String($currentPassword ?? "").trim()}
                            >{$_(
                              "pages.settings.inputs.change-email.continue",
                            )}</button>
                        </div>
                      {/if}
                    </div>
                  </form>
                </div>
              </div>
            {:else if row.id === "display-language"}
              {#if $session.siteInfo.allowUserLocaleSelection}
                <div class="row">
                  <label class="col-md-4 col-form-label" for="userLocaleCode">
                    {$_("pages.settings.inputs.display-language.title")}
                  </label>
                  <div class="col col-form-label">
                    <select
                      class="form-control"
                      id="userLocaleCode"
                      bind:value={$userLocale}>
                      {#each Object.keys($Languages) as language, index (language)}
                        <option value={$Languages[language].code}
                          >{$Languages[language].name}</option>
                      {/each}
                    </select>
                  </div>
                </div>
              {/if}
            {:else if row.props && row.props.label}
              <div class="row">
                <label class="col-md-4 col-form-label" for={row.id}>
                  {row.props.label && row.props.label.includes(".")
                    ? $_(row.props.label)
                    : row.props.label}
                </label>
                <div class="col col-form-label">
                  {#if row.component}
                    <ViewComponent
                      component={row.component}
                      data={row.props.data}
                      onRegister={(state) => registerPlugin(row.id, state)} />
                  {:else}
                    {row.props.value || ""}
                  {/if}
                </div>
              </div>
            {:else if row.component}
              <div class="row">
                <div class="col-12">
                  <ViewComponent
                    component={row.component}
                    data={row.props?.data || data}
                    onRegister={(state) => registerPlugin(row.id, state)} />
                </div>
              </div>
            {/if}
          {/each}

          {#if saveButtonVisible}
            <button
              class="btn btn-secondary"
              class:disabled={saveButtonDisabled}
              aria-disabled={saveButtonDisabled}
              onclick={handleSave}
              >{$_("buttons.save")}
            </button>
          {/if}
        </div>
      </div>
    {:else if item.id === "sessions-card"}
      <div class="card">
        <CardHeader truncateLeft={false}>
          <div slot="left">
            {$_("pages.settings.inputs.sessions.title")}
            <small class="d-block text-muted"
              >{$_("pages.settings.inputs.sessions.max-sessions-warning")}</small>
          </div>
        </CardHeader>
        {#if !sessions}
          <div class="text-center p-3">
            <div class="spinner-border text-primary" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
          </div>
        {:else if sessions.length === 0}
          <div class="card-body">
            <NoContent />
          </div>
        {:else}
          <div class="table-responsive">
            <table class="table table-hover">
              <thead>
                <tr>
                  <th class="align-middle">ID</th>
                  <th class="align-middle"></th>
                  <th class="align-middle">
                    <i
                      class="fas fa-window-maximize"
                      use:tooltip={[$_("pages.settings.inputs.sessions.browser"), { placement: "bottom" }]}
                    ></i>
                  </th>
                  <th class="align-middle">IP</th>
                  <th class="align-middle">
                    <i
                      class="fas fa-history"
                      use:tooltip={[$_("pages.settings.inputs.sessions.last-entrance"), { placement: "bottom" }]}
                    ></i>
                  </th>
                  <th class="align-middle">
                    <i
                      class="fas fa-hourglass-end"
                      use:tooltip={[$_("pages.settings.inputs.sessions.expire-date"), { placement: "bottom" }]}
                    ></i>
                  </th>
                  <th class="align-middle"></th>
                </tr>
              </thead>
              <tbody>
                {#each sessions as s}
                  <tr class:table-active={s.isCurrent}>
                    <td class="align-middle">
                      <code>#{s.id}</code>
                    </td>
                    <td class="align-middle">
                      {#if s.isCurrent}
                        <span class="badge text-bg-primary"
                          >{$_(
                            "pages.settings.inputs.sessions.current-session",
                          )}</span>
                      {/if}
                    </td>
                    <td class="align-middle">
                      <span title={s.userAgent}>
                        {parseUserAgent(s.userAgent)}
                      </span>
                    </td>
                    <td class="align-middle">
                      <code>{s.ip}</code>
                    </td>
                    <td class="align-middle"
                      ><DateComponent time={s.lastActivityTime} /></td>
                    <td class="align-middle"
                      ><DateComponent time={s.expireDate} /></td>
                    <td class="align-middle text-end">
                      <button
                        class="btn btn-link text-danger"
                        title={$_("buttons.logout")}
                        aria-label={$_("buttons.logout")}
                        onclick={() => {
                          if (s.isCurrent) {
                            setLogoutConfirmCallback(() => logout(session));
                            showLogoutConfirmModal();
                          } else {
                            onLogoutSession(
                              s.id,
                              loadingSessionId,
                              showToast,
                              invalidateAll,
                            );
                          }
                        }}
                        disabled={$loadingSessionId === s.id}>
                        {#if $loadingSessionId === s.id}
                          <span
                            class="spinner-border spinner-border-sm"
                            role="status"
                            aria-hidden="true"></span>
                        {:else}
                          <i class="fas fa-sign-out-alt"></i>
                        {/if}
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {:else if item.component}
      <!-- External plugin component -->
      <ViewComponent component={item.component} {data} {...item.props} />
    {/if}
  {/each}
</div>

<LogoutSessionConfirmModal />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/SettingsPageLogics";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    return processLoad(event);
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { _ } from "svelte-i18n";
  import { parseUserAgent } from "$pano/lib/string.util";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import PageActions from "$pano/lib/components/PageActions.svelte";
  import NoContent from "$pano/lib/components/NoContent.svelte";
  import CardHeader from "$pano/lib/components/CardHeader.svelte";
  import DateComponent from "$pano/lib/components/Date.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import tooltip from "$pano/lib/tooltip.util";
  import { show as showToast } from "$pano/lib/components/ToastContainer.svelte";
  import LogoutSessionConfirmModal, {
    show as showLogoutConfirmModal,
    setCallback as setLogoutConfirmCallback,
  } from "$pano/lib/components/modals/LogoutSessionConfirmModal.svelte";

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
  let sessions = [];

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

  $: sessions = data.sessions;
  
  let pluginStates = {};
  let totalDirtyPlugins = 0;
  let totalSaveablePlugins = 0;

  function registerPlugin(id, state) {
    if (!state) {
      delete pluginStates[id];
    } else {
      pluginStates[id] = state;
    }
    updateTotals();
  }

  function updateTotals() {
    totalDirtyPlugins = Object.values(pluginStates).filter((s) => s.isDirty).length;
    totalSaveablePlugins = Object.keys(pluginStates).length;
  }

  async function handleSave() {
    if (saveButtonDisabled) return;

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

  $: saveButtonVisible =
    $session.siteInfo.allowUserLocaleSelection || totalSaveablePlugins > 0;
  $: saveButtonDisabled =
    ($userLocale === $currentLanguage.code && totalDirtyPlugins === 0) ||
    $saveButtonLoading;
</script>
