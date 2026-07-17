<!--
  @view LoginView
  Controller: $pano/lib/pages/LoginPage.svelte
  Props:
    data                         object — page data (initialError, pageTitle, View)
    session                      store — session context (siteInfo, user, csrfToken)
    contentItems                 store — plugin-registered login content items (panoApiClient.ui.auth.login.content)
    altMethods                   store — plugin-registered alternative login methods
    viewState                    writable store — "LOGIN" | "LINK_CODE" | "REGISTER" | "SET_USERNAME"
    usernameOrEmail              writable store — username/email field value
    password                     writable store — password field value
    email                        writable store — register email field value
    passwordRepeat               writable store — register password-repeat field value
    agreement                    writable store — register agreement checkbox value
    newUsername                  writable store — new username field value (SET_USERNAME state)
    linkCode                     writable store — 6-digit link code value
    loading                      writable store — request in-flight flag
    error                        writable store — current error (string or { key, props })
    passwordVisible              writable store — whether the password field is shown
    emailRequired                writable store — backend requested a register email
    emailVerificationSent        writable store — verification email sent notice shown
    autoVerifyDone               writable store — link code auto-verify already attempted
    usernameRequiredUserId       writable store — user id pending username selection
    onSubmit                     function — submit the login / set-username form
    onVerifyLink                 function — verify the entered link code
    onCompleteRegister           function — complete the register-with-link flow
    onUsernameOrEmailFieldInput  function — input handler for the username/email field
    onRegisterEmailFieldInput    function — input handler for the register email field
    onNewUsernameFieldInput      function — input handler for the new username field
  Override from a theme:
    theme.config.js → views: { LoginView: () => import("./src/views/LoginView.svelte") }
-->
<style>
    #usernameOrEmail, #password {
        margin-bottom: -1px;
    }

    #usernameOrEmail:focus, #password:focus, #email:focus {
        position: relative;
        z-index: 2;
    }

    .alt-methods-divider {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        color: var(--bs-secondary);
        font-size: 0.85rem;
        margin-top: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .alt-methods-divider::before,
    .alt-methods-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--bs-border-color);
    }
</style>

<script>
  import { _ } from "svelte-i18n";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import LinkCodeInput from "$pano/lib/components/LinkCodeInput.svelte";
  import RegisterForm from "$pano/lib/components/RegisterForm.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  export let data;
  export let session;
  export let contentItems;
  export let altMethods;
  export let viewState;
  export let usernameOrEmail;
  export let password;
  export let email;
  export let passwordRepeat;
  export let agreement;
  export let newUsername;
  export let linkCode;
  export let loading;
  export let error;
  export let passwordVisible;
  export let emailRequired;
  export let emailVerificationSent;
  export let autoVerifyDone;
  export let usernameRequiredUserId;
  export let onSubmit;
  export let onVerifyLink;
  export let onCompleteRegister;
  export let onUsernameOrEmailFieldInput;
  export let onRegisterEmailFieldInput;
  export let onNewUsernameFieldInput;
</script>

{#each $contentItems as item (item.id)}
  {#if item.id === "login-form"}
    {#if $viewState === "LOGIN"}
      <form on:submit|preventDefault={onSubmit}>
        <div class="vstack gap-3">
          {#if $session.siteInfo.isDemo}
            <div class="alert alert-info py-2" role="alert">
              {$_("pages.login.demo-mode-alert")}
            </div>
          {/if}
          {#if $emailRequired && !$emailVerificationSent}
            <div class="alert alert-info py-2" role="alert">
              {$_("pages.login.register-email-required-info")}
            </div>
          {/if}
          <ErrorAlert error={$error} />
          {#if !$emailVerificationSent}
            <div class="form-group">
              <div class="form-floating">
                <input
                  bind:value={$usernameOrEmail}
                  class="form-control {$passwordVisible ? 'rounded-bottom-0' : 'rounded'}"
                  id="usernameOrEmail"
                  on:input={onUsernameOrEmailFieldInput}
                  disabled={$loading || $emailRequired}
                  type="text" />
                <label for="usernameOrEmail">
                  {$emailRequired ? $_("components.modals.register.inputs.username") : $_("components.modals.login.inputs.username-email")}
                </label>
              </div>

              {#if $passwordVisible}
                <div class="form-floating">
                  <input
                    bind:value={$password}
                    class="form-control rounded-0 {$emailRequired ? '' : 'rounded-bottom'}"
                    id="password"
                    on:input={() => {
                      $error = null;
                    }}
                    disabled={$loading || $emailRequired}
                    type="password" />
                  <label for="password">
                    {$_("components.modals.login.inputs.password")}
                  </label>
                </div>
              {/if}

              {#if $emailRequired}
                <div class="form-floating">
                  <input
                    bind:value={$email}
                    class="form-control rounded-top-0 rounded-bottom {$error ? 'border-danger' : ''}"
                    id="email"
                    on:input={onRegisterEmailFieldInput}
                    disabled={$loading}
                    type="email" />
                  <label for="email">
                    {$_("components.modals.register.inputs.email")}
                  </label>
                </div>
              {/if}
            </div>
            {#each $contentItems as inlineItem (inlineItem.id)}
              {#if inlineItem.id !== 'login-form' && inlineItem.component && (inlineItem.priority || 0) < 100}
                <ViewComponent component={inlineItem.component} data={{ pageType: 'login' }} />
              {/if}
            {/each}
            <div class="vstack gap-2">
              <button
                class="btn btn-lg btn-secondary"
                class:disabled={$loading || !$usernameOrEmail || ($emailRequired && !$email.includes('@'))}
                disabled={$loading || !$usernameOrEmail || ($emailRequired && !$email.includes('@'))}
                type="submit">
                {#if $loading}
                  <span
                    class="spinner-border spinner-border-sm me-2"
                    role="status"
                    aria-label="Loading"></span>
                  <span>{$_("buttons.login")}...</span>
                {:else}
                  {$_("buttons.login")}
                {/if}
              </button>
              {#if $passwordVisible && !$emailRequired}
                <a
                  class="btn btn-link {$loading ? 'disabled pe-none' : ''}"
                  aria-disabled={$loading}
                  tabindex={$loading ? -1 : undefined}
                  href="/reset-password">
                  {$_("buttons.forgot-password")}
                </a>
              {/if}
            </div>
          {:else}
            <div class="alert alert-info py-2" role="alert">
              {$_("pages.login.email-verification-sent-info")}
            </div>
            <button
              class="btn btn-link"
              type="button"
              on:click={() => {
                $emailVerificationSent = false;
                $emailRequired = false;
                $passwordVisible = false;
                $email = "";
                $password = "";
                $error = null;
              }}>
              {$_("pages.settings.inputs.change-email.back")}
            </button>
          {/if}
        </div>
      </form>
    {:else if $viewState === "LINK_CODE"}
      <form on:submit|preventDefault={onVerifyLink}>
        <div class="vstack gap-3">
          <p class="text-center text-muted mb-0">
            {@html $_("components.modals.login.link-code.description")}
          </p>

          <ErrorAlert error={$error} />

          <div class="form-group">
            <div class="form-floating">
              <input
                bind:value={$usernameOrEmail}
                class="form-control"
                id="usernameOrEmail"
                disabled={true}
                type="text" />
              <label for="usernameOrEmail">
                {$_("components.modals.login.inputs.username-email")}
              </label>
            </div>
          </div>

          <div class="my-2">
            <LinkCodeInput
              isInvalid={$error === "REGISTER_LINK_CODE_INVALID"}
              disabled={$loading}
              on:complete={(e) => {
                $linkCode = e.detail.code;
                if (!$autoVerifyDone) {
                  onVerifyLink();
                }
              }}
              on:change={(e) => $linkCode = e.detail.code} />
          </div>

          {#each $contentItems as inlineItem (inlineItem.id)}
            {#if inlineItem.id !== 'login-form' && inlineItem.component && (inlineItem.priority || 0) < 100}
              <ViewComponent component={inlineItem.component} data={{ pageType: 'login' }} />
            {/if}
          {/each}

          <div class="vstack gap-2">
            <button
              class="btn btn-lg btn-secondary"
              class:disabled={$loading || $linkCode.length !== 6}
              disabled={$loading || $linkCode.length !== 6}
              type="submit">
              {#if $loading}
                <span
                  class="spinner-border spinner-border-sm me-2"
                  role="status"
                  aria-label="Loading"></span>
                <span>{$_("components.modals.login.link-code.verify")}...</span>
              {:else}
                {$_("components.modals.login.link-code.verify")}
              {/if}
            </button>
            <button
              class="btn btn-link"
              disabled={$loading}
              type="button"
              on:click={() => {
                $viewState = "LOGIN";
                $error = null;
                $autoVerifyDone = false;
                $linkCode = "";
                $password = "";
              }}>
              {$_("pages.settings.inputs.change-email.back")}
            </button>
          </div>
        </div>
      </form>
    {:else if $viewState === "REGISTER"}
      <form on:submit|preventDefault={onCompleteRegister}>
        <div class="vstack gap-3">
          <ErrorAlert error={$error} />

          <RegisterForm
            bind:username={$usernameOrEmail}
            bind:email={$email}
            bind:password={$password}
            bind:passwordRepeat={$passwordRepeat}
            bind:agreement={$agreement}
            loading={$loading}
            usernameDisabled={true} />
        </div>
      </form>
    {:else if $viewState === "SET_USERNAME"}
      <form on:submit|preventDefault={onSubmit}>
        <div class="vstack gap-3">
          <PageTitle title={$_("pages.login.set-username-title")} />
          <p class="text-center text-muted mb-0">
            {$_("pages.login.set-username-description")}
          </p>
          <ErrorAlert error={$error} />
          <div class="form-group">
            <div class="form-floating">
              <input
                bind:value={$newUsername}
                class="form-control"
                id="newUsername"
                on:input={onNewUsernameFieldInput}
                disabled={$loading}
                type="text"
                maxlength="16" />
              <label for="newUsername">
                {$_("components.modals.register.inputs.username")}
              </label>
            </div>
          </div>
          <div class="vstack gap-2">
            <button
              class="btn btn-lg btn-secondary"
              class:disabled={$loading || !$newUsername || $newUsername.length < 3}
              disabled={$loading || !$newUsername || $newUsername.length < 3}
              type="submit">
              {#if $loading}
                <span
                  class="spinner-border spinner-border-sm me-2"
                  role="status"
                  aria-label="Loading"></span>
                <span>{$_("buttons.save")}...</span>
              {:else}
                {$_("buttons.save")}
              {/if}
            </button>
            <button
              class="btn btn-link"
              disabled={$loading}
              type="button"
              on:click={() => {
                $viewState = "LOGIN";
                $error = null;
                $newUsername = "";
                $usernameRequiredUserId = null;
                $password = "";
                $passwordVisible = false;
              }}>
              {$_("pages.settings.inputs.change-email.back")}
            </button>
          </div>
        </div>
      </form>
    {/if}
  {:else if item.component && $viewState !== "SET_USERNAME" && (item.priority || 0) >= 100}
    <ViewComponent component={item.component} data={{ pageType: 'login' }} />
  {/if}
{/each}

{#if $viewState !== "SET_USERNAME" && $altMethods && $altMethods.length > 0}
  <div class="alt-methods-divider">
    <span>{$_("pages.login.or")}</span>
  </div>
  <div class="vstack gap-2">
    {#each $altMethods as method (method.id)}
      <ViewComponent component={method.component} data={{ pageType: 'login' }} />
    {/each}
  </div>
{/if}
