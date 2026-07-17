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
  import { getContext, onMount } from "svelte";
  import { format } from "date-fns";
  import * as locales from "date-fns/locale";

  import { afterNavigate, goto } from "$app/navigation";

  import { NETWORK_ERROR } from "$pano/lib/api.util";
  import { currentLanguage } from "$pano/lib/language.util";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import LinkCodeInput from "$pano/lib/components/LinkCodeInput.svelte";
  import RegisterForm from "$pano/lib/components/RegisterForm.svelte";

  import { getCredentials, sendLogin, sendRegister, verifyLinkCode } from "$pano/lib/services/auth.js";
  import { show as showToast } from "$pano/lib/components/ToastContainer.svelte";

  import { stripIdentifierWhitespace } from "$pano/lib/loginInput.util.js";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  export let data;

  let viewState = "LOGIN"; // LOGIN, LINK_CODE, REGISTER, REGISTER_EMAIL, SET_USERNAME

  let usernameOrEmail = "",
    password = "";
  let loading, error;

  // Read initial error from lifecycle (plugin-injected)
  if (data?.initialError) {
    error = data.initialError;
  }

  let _skipFirstNav = !!data?.initialError;

  let passwordVisible = false;

  $: if ($session?.siteInfo?.isDemo && usernameOrEmail === "demo") {
    password = "123456";
    passwordVisible = true;
  }

  // Register fields
  let linkCode = "";
  let email = "";
  let passwordRepeat = "";
  let agreement = false;
  let registerToken = "";
  let autoVerifyDone = false;
  let emailRequired = false;
  let emailVerificationSent = false;
  let newUsername = "";
  let usernameRequiredUserId = null;

  const session = getContext("session");

  function onUsernameOrEmailFieldInput() {
    const c = stripIdentifierWhitespace(usernameOrEmail);
    if (c !== usernameOrEmail) {
      usernameOrEmail = c;
    }
    if (!emailRequired && !($session?.siteInfo?.isDemo && usernameOrEmail === "demo")) {
      passwordVisible = false;
      password = "";
    }
    error = null;
  }

  function onRegisterEmailFieldInput() {
    const c = stripIdentifierWhitespace(email);
    if (c !== email) {
      email = c;
    }
    error = null;
  }

  function onNewUsernameFieldInput() {
    const c = stripIdentifierWhitespace(newUsername);
    if (c !== newUsername) {
      newUsername = c;
    }
    error = null;
  }

  afterNavigate(() => {
    if (_skipFirstNav) {
      _skipFirstNav = false;
      return;
    }
    viewState = "LOGIN";
    error = null;
    autoVerifyDone = false;
    linkCode = "";
    passwordVisible = false;
    emailRequired = false;
    email = "";
    emailVerificationSent = false;
    password = "";
    newUsername = "";
    usernameRequiredUserId = null;
  });

  async function onVerifyLink() {
    if (linkCode.length !== 6) return;
    loading = true;
    error = null;
    autoVerifyDone = true;

    try {
      const body = await verifyLinkCode(usernameOrEmail, linkCode);
      if (body.result === "ok") {
        registerToken = body.token;
        // Assuming backend returns username associated with code
        if (body.username) {
          usernameOrEmail = body.username;
        }
        viewState = "REGISTER";
      } else {
        if (body.error === "PLUGIN_DENIED_LOGIN" && body.reason) {
          error = body.reason;
        } else {
          error = body.result === "error" ? body.error : NETWORK_ERROR;
        }
      }
    } catch (err) {
      console.error(err);
      error = NETWORK_ERROR;
    } finally {
      loading = false;
    }
  }

  async function onCompleteRegister() {
    loading = true;
    error = null;

    // Check agreement if required
    // RegisterForm handles UI, but we need to check logic if we want client side validation or trust backend

    try {
      const body = await sendRegister({
        registerWithLinkToken: registerToken,
        email,
        password,
        passwordRepeat,
        agreement,
      });

      if (body.result !== "ok") {
        if (body.error === "INVALID_TOKEN") {
          viewState = "LOGIN";
          error = null;
          autoVerifyDone = false;
          linkCode = "";
          loading = false;
          return;
        }
        error = body.result === "error" ? body.error : NETWORK_ERROR;
        loading = false;
        return;
      }

      if (body.login) {
        const csrfToken = body.csrfToken;
        const credsBody = await getCredentials(csrfToken);

        session.update((data) => {
          data.user = {
            ...Object.keys(credsBody)
              .filter((key) => !["result"].includes(key))
              .reduce((object, key) => {
                object[key] = credsBody[key];
                return object;
              }, {})
          };
          data.csrfToken = csrfToken;
          return data;
        });

        await showToast("successes.LOGIN_SUCCESSFUL");
        await goto("/");
        return;
      }

      if (body.emailVerificationRequired) {
        viewState = "LOGIN";
        registerToken = "";
        linkCode = "";
        password = "";
        passwordRepeat = "";
        error = { key: "LOGIN_EMAIL_NOT_VERIFIED", props: { email: body.email ?? email } };
        return;
      }

      await showToast("successes.REGISTER_SUCCESSFUL");

      const loginBody = await sendLogin({ usernameOrEmail, password });
      if (loginBody.result !== "ok") {
        error = loginBody.error;
        loading = false;
        return;
      }

      const csrfToken = loginBody.csrfToken;
      const credsBody = await getCredentials(csrfToken);

      session.update((data) => {
        data.user = {
          ...Object.keys(credsBody)
            .filter((key) => !["result"].includes(key))
            .reduce((object, key) => {
              object[key] = credsBody[key];
              return object;
            }, {})
        };
        data.csrfToken = csrfToken;
        return data;
      });

      await goto("/");

    } catch (err) {
      console.error(err);
      error = NETWORK_ERROR;
    } finally {
      loading = false;
    }
  }

  async function onSubmit() {
    error = null;
    loading = true;

    await sendLogin({
      usernameOrEmail,
      password,
      registerEmail: emailRequired ? email : undefined,
      newUsername: viewState === "SET_USERNAME" ? newUsername : undefined
    })
      .then(async (body) => {
        if (body.result !== "ok") {
          loading = false;
          if (body.error === "LINK_CODE_REQUIRED") {
            viewState = "LINK_CODE";
            passwordVisible = false;
            password = "";
            error = null;
            return;
          }

          if (body.error === "LOGIN_EMAIL_NOT_VERIFIED") {
            if (emailRequired) {
              emailVerificationSent = true;
              error = null;
              return;
            }
            error = { key: "LOGIN_EMAIL_NOT_VERIFIED", props: { email: body.email } };
            return;
          }

          if (body.error === "REGISTER_EMAIL_REQUIRED") {
            emailRequired = true;
            passwordVisible = true;
            if ($session?.siteInfo?.isDemo && usernameOrEmail === "demo") {
              password = "123456";
            }
            error = null;
            setTimeout(() => document.getElementById("email")?.focus(), 50);
            return;
          }

          if (body.error === "USERNAME_REQUIRED") {
            usernameRequiredUserId = body.userId;
            viewState = "SET_USERNAME";
            error = null;
            setTimeout(() => document.getElementById("newUsername")?.focus(), 50);
            return;
          }

          if (body.error === "LOGIN_IS_INVALID" && !passwordVisible) {
            passwordVisible = true;
            if ($session?.siteInfo?.isDemo && usernameOrEmail === "demo") {
              password = "123456";
            }
            error = null;
            setTimeout(() => document.getElementById("password")?.focus(), 50);
            return;
          }

          if (body.error === "PLUGIN_DENIED_LOGIN" && body.reason) {
            error = body.reason;
            return;
          }

          error = body.result === "error" ? body.error : NETWORK_ERROR;

          if (
            body.result === "error" &&
            body.error === "LOGIN_USER_IS_BANNED"
          ) {
            if (!body.until) {
              error = { key: "LOGIN_USER_IS_BANNED_PERMANENTLY" };
              if (body.reason) {
                error = {
                  key: "LOGIN_USER_IS_BANNED_PERMANENTLY_WITH_REASON",
                  props: { reason: `'${body.reason}'` }
                };
              }
            } else {
              const formattedUntil = format(
                new Date(body.until),
                "dd/MM/yyyy HH:mm",
                {
                  locale: locales[$currentLanguage.dateFnsCode]
                }
              );

              error = {
                key: "LOGIN_USER_IS_BANNED_TEMPORARY",
                props: { untilTime: formattedUntil }
              };

              if (body.reason) {
                error = {
                  key: "LOGIN_USER_IS_BANNED_TEMPORARY_WITH_REASON",
                  props: {
                    reason: `'${body.reason}'`,
                    untilTime: formattedUntil
                  }
                };
              }
            }
          }
          return;
        }

        const csrfToken = body.csrfToken;

        await getCredentials(csrfToken).then(async (body) => {
          session.update((data) => {
            data.user = {
              ...Object.keys(body)
                .filter((key) => !["result"].includes(key))
                .reduce((object, key) => {
                  object[key] = body[key];

                  return object;
                }, {})
            };

            data.csrfToken = csrfToken;

            return data;
          });

          await showToast("successes.LOGIN_SUCCESSFUL");

          await goto("/");

          loading = false;
        });
      })
      .catch((err) => {
        console.log(err);
        loading = false;
      });
  }

  const pageTitle = getContext("pageTitle");

  $: if (viewState === "LOGIN") {
    $pageTitle = "components.modals.login.title";
  } else if (viewState === "LINK_CODE") {
    $pageTitle = "components.modals.login.link-code.title";
  } else if (viewState === "REGISTER") {
    $pageTitle = "components.modals.login.register-with-link.title";
  }

  onMount(() => {
    if ($session.siteInfo.isDemo) {
      usernameOrEmail = "demo";
      password = "123456";
      passwordVisible = true;
    }

    if (!$session.siteInfo.hasRegisterAgreement) {
      agreement = true;
    }
  });

  const contentItems = panoApiClient.ui.auth.login.content.get();
  const altMethods = panoApiClient.ui.auth.login.alternativeMethods.get();
</script>

<script context="module">
  import { executeLifecycle, executeViewLoad, panoApiServer } from "$pano/lib/PluginAPI";

  export async function load(event) {
    const { parent } = event;
    await parent();

    // Initialize login content
    panoApiServer.ui.auth.login.content.edit((items) => {
      items.push({ id: "login-form", priority: 100, hidden: false });
    });

    const lifecycleData = { error: null, event };
    await executeLifecycle("theme:login:load", lifecycleData, event);
    await executeViewLoad("login-content", event);
    await executeViewLoad("login-alt-methods", event);

    return { initialError: lifecycleData.error || null, pageTitle: "components.modals.login.title" };
  }
</script>

{#each $contentItems as item (item.id)}
  {#if item.id === "login-form"}
    {#if viewState === "LOGIN"}
      <form on:submit|preventDefault={onSubmit}>
        <div class="vstack gap-3">
          {#if $session.siteInfo.isDemo}
            <div class="alert alert-info py-2" role="alert">
              {$_("pages.login.demo-mode-alert")}
            </div>
          {/if}
          {#if emailRequired && !emailVerificationSent}
            <div class="alert alert-info py-2" role="alert">
              {$_("pages.login.register-email-required-info")}
            </div>
          {/if}
          <ErrorAlert error={error} />
          {#if !emailVerificationSent}
            <div class="form-group">
              <div class="form-floating">
                <input
                  bind:value={usernameOrEmail}
                  class="form-control {passwordVisible ? 'rounded-bottom-0' : 'rounded'}"
                  id="usernameOrEmail"
                  on:input={onUsernameOrEmailFieldInput}
                  disabled={loading || emailRequired}
                  type="text" />
                <label for="usernameOrEmail">
                  {emailRequired ? $_("components.modals.register.inputs.username") : $_("components.modals.login.inputs.username-email")}
                </label>
              </div>

              {#if passwordVisible}
                <div class="form-floating">
                  <input
                    bind:value={password}
                    class="form-control rounded-0 {emailRequired ? '' : 'rounded-bottom'}"
                    id="password"
                    on:input={() => {
                      error = null;
                    }}
                    disabled={loading || emailRequired}
                    type="password" />
                  <label for="password">
                    {$_("components.modals.login.inputs.password")}
                  </label>
                </div>
              {/if}

              {#if emailRequired}
                <div class="form-floating">
                  <input
                    bind:value={email}
                    class="form-control rounded-top-0 rounded-bottom {error ? 'border-danger' : ''}"
                    id="email"
                    on:input={onRegisterEmailFieldInput}
                    disabled={loading}
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
                class:disabled={loading || !usernameOrEmail || (emailRequired && !email.includes('@'))}
                disabled={loading || !usernameOrEmail || (emailRequired && !email.includes('@'))}
                type="submit">
                {#if loading}
                  <span
                    class="spinner-border spinner-border-sm me-2"
                    role="status"
                    aria-label="Loading"></span>
                  <span>{$_("buttons.login")}...</span>
                {:else}
                  {$_("buttons.login")}
                {/if}
              </button>
              {#if passwordVisible && !emailRequired}
                <a
                  class="btn btn-link {loading ? 'disabled pe-none' : ''}"
                  aria-disabled={loading}
                  tabindex={loading ? -1 : undefined}
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
                emailVerificationSent = false;
                emailRequired = false;
                passwordVisible = false;
                email = "";
                password = "";
                error = null;
              }}>
              {$_("pages.settings.inputs.change-email.back")}
            </button>
          {/if}
        </div>
      </form>
    {:else if viewState === "LINK_CODE"}
      <form on:submit|preventDefault={onVerifyLink}>
        <div class="vstack gap-3">
          <p class="text-center text-muted mb-0">
            {@html $_("components.modals.login.link-code.description")}
          </p>

          <ErrorAlert error={error} />

          <div class="form-group">
            <div class="form-floating">
              <input
                bind:value={usernameOrEmail}
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
              isInvalid={error === "REGISTER_LINK_CODE_INVALID"}
              disabled={loading}
              on:complete={(e) => {
                linkCode = e.detail.code;
                if (!autoVerifyDone) {
                  onVerifyLink();
                }
              }}
              on:change={(e) => linkCode = e.detail.code} />
          </div>

          {#each $contentItems as inlineItem (inlineItem.id)}
            {#if inlineItem.id !== 'login-form' && inlineItem.component && (inlineItem.priority || 0) < 100}
              <ViewComponent component={inlineItem.component} data={{ pageType: 'login' }} />
            {/if}
          {/each}

          <div class="vstack gap-2">
            <button
              class="btn btn-lg btn-secondary"
              class:disabled={loading || linkCode.length !== 6}
              disabled={loading || linkCode.length !== 6}
              type="submit">
              {#if loading}
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
              disabled={loading}
              type="button"
              on:click={() => {
                viewState = "LOGIN";
                error = null;
                autoVerifyDone = false;
                linkCode = "";
                password = "";
              }}>
              {$_("pages.settings.inputs.change-email.back")}
            </button>
          </div>
        </div>
      </form>
    {:else if viewState === "REGISTER"}
      <form on:submit|preventDefault={onCompleteRegister}>
        <div class="vstack gap-3">
          <ErrorAlert error={error} />

          <RegisterForm
            bind:username={usernameOrEmail}
            bind:email={email}
            bind:password={password}
            bind:passwordRepeat={passwordRepeat}
            bind:agreement={agreement}
            loading={loading}
            usernameDisabled={true} />
        </div>
      </form>
    {:else if viewState === "SET_USERNAME"}
      <form on:submit|preventDefault={onSubmit}>
        <div class="vstack gap-3">
          <PageTitle title={$_("pages.login.set-username-title")} />
          <p class="text-center text-muted mb-0">
            {$_("pages.login.set-username-description")}
          </p>
          <ErrorAlert error={error} />
          <div class="form-group">
            <div class="form-floating">
              <input
                bind:value={newUsername}
                class="form-control"
                id="newUsername"
                on:input={onNewUsernameFieldInput}
                disabled={loading}
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
              class:disabled={loading || !newUsername || newUsername.length < 3}
              disabled={loading || !newUsername || newUsername.length < 3}
              type="submit">
              {#if loading}
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
              disabled={loading}
              type="button"
              on:click={() => {
                viewState = "LOGIN";
                error = null;
                newUsername = "";
                usernameRequiredUserId = null;
                password = "";
                passwordVisible = false;
              }}>
              {$_("pages.settings.inputs.change-email.back")}
            </button>
          </div>
        </div>
      </form>
    {/if}
  {:else if item.component && viewState !== "SET_USERNAME" && (item.priority || 0) >= 100}
    <ViewComponent component={item.component} data={{ pageType: 'login' }} />
  {/if}
{/each}

{#if viewState !== "SET_USERNAME" && $altMethods && $altMethods.length > 0}
  <div class="alt-methods-divider">
    <span>{$_("pages.login.or")}</span>
  </div>
  <div class="vstack gap-2">
    {#each $altMethods as method (method.id)}
      <ViewComponent component={method.component} data={{ pageType: 'login' }} />
    {/each}
  </div>
{/if}
