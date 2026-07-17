<script context="module">
  import { executeLifecycle, executeViewLoad, panoApiServer } from "$pano/lib/PluginAPI";

  export async function load(event) {
    const { parent } = event;
    await parent();

    // Initialize register content
    panoApiServer.ui.auth.register.content.edit((items) => {
      items.push({ id: "register-form", priority: 100, hidden: false });
    });

    const lifecycleData = { error: null, username: null, event };
    await executeLifecycle("theme:register:load", lifecycleData, event);
    await executeViewLoad("register-content", event);
    await executeViewLoad("register-alt-methods", event);

    return {
      initialError: lifecycleData.error || null,
      initialUsername: lifecycleData.username || null,
      pageTitle: "components.modals.register.title"
    };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { _ } from "svelte-i18n";
  import { goto } from "$app/navigation";

  import { NETWORK_ERROR } from "$pano/lib/api.util";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import SuccessAlert from "$pano/lib/components/SuccessAlert.svelte";
  import RegisterForm from "$pano/lib/components/RegisterForm.svelte";
  import { show as showToast } from "$pano/lib/components/ToastContainer.svelte";

  import { sendRegister, getCredentials } from "$pano/lib/services/auth.js";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  export let data;

  const session = getContext("session");

  let loading, error, successMessage;
  let username = "",
    email = "",
    password = "",
    passwordRepeat = "";

  // Read initial values from lifecycle (plugin-injected)
  if (data?.initialError) {
    error = data.initialError;
  }
  if (data?.initialUsername) {
    username = data.initialUsername;
  }

  let agreement = !$session.siteInfo.hasRegisterAgreement ? true : false;

  async function onSubmit() {
    error = null;
    successMessage = null;
    loading = true;

    await sendRegister({
      username,
      email,
      password,
      passwordRepeat,
      agreement,
      recaptcha: "",
    })
      .then(async (body) => {
        if (body.result === "ok") {
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
            loading = false;
            return;
          }

          successMessage = "REGISTER_SUCCESSFUL";
          loading = false;
        } else {
          if (body.error === "PLUGIN_DENIED_LOGIN" && body.reason) {
            error = body.reason;
          } else {
            error = body.result === "error" ? body.error : NETWORK_ERROR;
          }
          loading = false;
        }
      })
      .catch(() => {
        loading = false;

        error = NETWORK_ERROR;
      });
  }

  const contentItems = panoApiClient.ui.auth.register.content.get();
  const altMethods = panoApiClient.ui.auth.register.alternativeMethods.get();
</script>

<style>
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

<div class="container mx-auto">
  <div class="vstack gap-3">
    {#each $contentItems as item (item.id)}
      {#if item.id === "register-form"}
        <form on:submit|preventDefault={onSubmit}>
          <div class="vstack gap-3">
            <SuccessAlert message={successMessage} />
            <ErrorAlert error={error} />

            <RegisterForm
              bind:username={username}
              bind:email={email}
              bind:password={password}
              bind:passwordRepeat={passwordRepeat}
              bind:agreement={agreement}
              loading={loading}>
              <div slot="beforeSubmit">
                {#each $contentItems as inlineItem (inlineItem.id)}
                  {#if inlineItem.id !== 'register-form' && inlineItem.component && (inlineItem.priority || 0) < 100}
                    <ViewComponent component={inlineItem.component} data={{ pageType: 'register' }} />
                  {/if}
                {/each}
              </div>
              <div slot="footer" class="text-center">
                <a
                  class="btn btn-link {loading ? 'disabled pe-none' : ''}"
                  aria-disabled={loading}
                  tabindex={loading ? -1 : undefined}
                  href="/login">
                  {$_("buttons.already-registered")}
                </a>
              </div>
            </RegisterForm>
          </div>
        </form>
      {:else if item.component && (item.priority || 0) >= 100}
        <ViewComponent component={item.component} data={{ pageType: 'register' }} />
      {/if}
    {/each}

    {#if $altMethods && $altMethods.length > 0}
      <div class="alt-methods-divider">
        <span>{$_("pages.login.or")}</span>
      </div>
      <div class="vstack gap-2">
        {#each $altMethods as method (method.id)}
          <ViewComponent component={method.component} data={{ pageType: 'register' }} />
        {/each}
      </div>
    {/if}
  </div>
</div>
