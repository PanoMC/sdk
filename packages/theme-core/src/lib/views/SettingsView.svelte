<!--
  @view SettingsView
  Controller: $pano/lib/pages/profile/SettingsPage.svelte
  Props:
    data                       object — page data (sessions, View)
    session                    store — session context (siteInfo, user, csrfToken)
    contentItems               store — plugin-registered settings content items (panoApiClient.ui.settings.content)
    cardRowItems               store — plugin-registered settings card rows (panoApiClient.ui.settings.cardRows)
    Languages                  store — available UI languages keyed by id ({ code, name })
    resetPasswordError         writable store — error key of the reset-password action
    resetPasswordLoading       writable store — reset-password request in-flight flag
    resetPasswordSuccess       writable store — reset-password link sent flag
    currentPassword            writable store — current password field value (change-email step 1)
    newEmail                   writable store — new email field value (change-email step 2)
    changingEmail              writable store — change-email flow open flag
    changingEmail2ndStep       writable store — change-email flow is on the new-email step
    changingEmailError         writable store — error key of the change-email flow
    changingEmailLoading       writable store — change-email request in-flight flag
    changingEmailSuccess       writable store — change-email confirmation link sent flag
    userLocale                 writable store — selected display-language code
    loadingSessionId           writable store — id of the session whose logout is in flight
    saveButtonVisible          derived store — whether the save button is rendered
    saveButtonDisabled         derived store — whether the save button is disabled
    sendResetPasswordLink      function — request a reset-password email
    sendChangeEmailLink        function — request the change-email confirmation email
    startChangingEmail         function — open the change-email flow
    startChangingEmail2ndStep  function — advance the change-email flow to the new-email step
    stopChangingEmail          function — cancel the change-email flow
    stopChangingEmail2ndStep   function — go back to the current-password step
    onLogoutSession            function — log out another session by id
    registerPlugin             function — register/unregister a plugin row's save state
    handleSave                 function — save locale change + dirty plugin rows
    logout                     function — log out the current session
    showToast                  function — show a toast notification
    invalidateAll              function — SvelteKit invalidateAll (refresh load data)
    parseUserAgent             function — user-agent string → short browser label
    stripIdentifierWhitespace  function — strip whitespace from identifier input
  Override from a theme:
    theme.config.js → views: { SettingsView: () => import("./src/views/SettingsView.svelte") }
-->
<!-- Settings -->
<div class="pano-settings-view vstack gap-3">
  {#each $contentItems as item (item.id)}
    {#if item.id === "settings-cards"}
      <div class="card mt-3 mt-lg-0">
        <CardHeader>
          <div slot="left">{$_("pages.settings.title")}</div>
        </CardHeader>
        <div class="pano-settings-view__body card-body">
          {#each $cardRowItems as row (row.id)}
            {#if row.id === "change-password"}
              <div class="row">
                <label class="col-md-4 col-form-label" for="resetPassword">
                  {$_("pages.settings.inputs.change-password.title")}
                </label>
                <div class="col col-form-label">
                  <button
                    class="pano-settings-view__action btn btn-link"
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
                              class="pano-settings-view__description btn btn-link"
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
                            class="pano-settings-view__input form-control"
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
                            class="pano-settings-view__back btn btn-link link-primary"
                            onclick={() =>
                              stopChangingEmail2ndStep(
                                changingEmail2ndStep,
                                changingEmailError,
                              )}>
                            {$_("pages.settings.inputs.change-email.back")}
                          </button>
                          <button
                            type="submit"
                            class="pano-settings-view__confirm btn btn-link link-secondary"
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
                            class="pano-settings-view__current-password-placeholder form-control"
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
                            class="pano-settings-view__cancel btn btn-link link-danger"
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
                            class="pano-settings-view__continue btn btn-link"
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
                      class="pano-settings-view__input-2 form-control"
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

          {#if $saveButtonVisible}
            <button
              class="pano-settings-view__save btn btn-secondary"
              class:disabled={$saveButtonDisabled}
              aria-disabled={$saveButtonDisabled}
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
            <div>{$_("pages.settings.inputs.sessions.title")}</div>
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
          <div class="pano-settings-view__body-2 card-body">
            <NoContent />
          </div>
        {:else}
          <div class="table-responsive">
            <table class="pano-settings-view__table table table-hover">
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
                        <span class="pano-settings-view__badge badge text-bg-primary"
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
                        class="pano-settings-view__logout btn btn-link text-danger"
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

<script>
  import { _ } from "svelte-i18n";

  import NoContent from "$pano/lib/components/NoContent.svelte";
  import CardHeader from "$pano/lib/components/CardHeader.svelte";
  import DateComponent from "$pano/lib/components/Date.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import tooltip from "$pano/lib/tooltip.util";
  import LogoutSessionConfirmModal, {
    show as showLogoutConfirmModal,
    setCallback as setLogoutConfirmCallback,
  } from "$pano/lib/components/modals/LogoutSessionConfirmModal.svelte";

  export let data;
  export let session;
  export let contentItems;
  export let cardRowItems;
  export let Languages;
  export let resetPasswordError;
  export let resetPasswordLoading;
  export let resetPasswordSuccess;
  export let currentPassword;
  export let newEmail;
  export let changingEmail;
  export let changingEmail2ndStep;
  export let changingEmailError;
  export let changingEmailLoading;
  export let changingEmailSuccess;
  export let userLocale;
  export let loadingSessionId;
  export let saveButtonVisible;
  export let saveButtonDisabled;
  export let sendResetPasswordLink;
  export let sendChangeEmailLink;
  export let startChangingEmail;
  export let startChangingEmail2ndStep;
  export let stopChangingEmail;
  export let stopChangingEmail2ndStep;
  export let onLogoutSession;
  export let registerPlugin;
  export let handleSave;
  export let logout;
  export let showToast;
  export let invalidateAll;
  export let parseUserAgent;
  export let stripIdentifierWhitespace;

  let sessions = [];
  $: sessions = data.sessions;
</script>

<style>
  /* Narrow screens: stack each session as a wrapped row so the dates stay inside the card. */
  @media (max-width: 575.98px) {
    .pano-settings-view__table,
    .pano-settings-view__table tbody {
      display: block;
      width: 100%;
    }
    .pano-settings-view__table thead {
      display: none;
    }
    .pano-settings-view__table tr {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem 0.75rem;
      padding: 0.5rem 0.75rem;
    }
    .pano-settings-view__table td {
      display: block;
      padding: 0;
      border: 0;
      background: transparent;
      box-shadow: none;
    }
    .pano-settings-view__table td:last-child {
      margin-left: auto;
    }
  }
</style>
