<!--
  @view RegisterView
  Controller: $pano/lib/pages/RegisterPage.svelte
  Props:
    data.pageTitle  string — i18n key of the page title ("components.modals.register.title")
    contentItems    store<Array> — plugin-extensible register page content items ({ id, priority, component })
    altMethods      store<Array> — alternative registration methods injected by plugins
    onSubmit        function — submits the register form
    loading         store<boolean> — true while the register request is in flight
    error           store<string|null> — error key shown in the ErrorAlert
    successMessage  store<string|null> — success key shown in the SuccessAlert
    username        store<string> — bound username field value
    email           store<string> — bound email field value
    password        store<string> — bound password field value
    passwordRepeat  store<string> — bound password confirmation field value
    agreement       store<boolean> — bound register-agreement checkbox value
  Override from a theme:
    theme.config.js → views: { RegisterView: () => import("./src/views/RegisterView.svelte") }
-->
<div class="container mx-auto">
  <div class="vstack gap-3">
    {#each $contentItems as item (item.id)}
      {#if item.id === "register-form"}
        <form on:submit|preventDefault={onSubmit}>
          <div class="vstack gap-3">
            <SuccessAlert message={$successMessage} />
            <ErrorAlert error={$error} />

            <RegisterForm
              bind:username={$username}
              bind:email={$email}
              bind:password={$password}
              bind:passwordRepeat={$passwordRepeat}
              bind:agreement={$agreement}
              loading={$loading}>
              <div slot="beforeSubmit">
                {#each $contentItems as inlineItem (inlineItem.id)}
                  {#if inlineItem.id !== 'register-form' && inlineItem.component && (inlineItem.priority || 0) < 100}
                    <ViewComponent component={inlineItem.component} data={{ pageType: 'register' }} />
                  {/if}
                {/each}
              </div>
              <div slot="footer" class="text-center">
                <a
                  class="btn btn-link {$loading ? 'disabled pe-none' : ''}"
                  aria-disabled={$loading}
                  tabindex={$loading ? -1 : undefined}
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

<script>
  import { _ } from "svelte-i18n";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import SuccessAlert from "$pano/lib/components/SuccessAlert.svelte";
  import RegisterForm from "$pano/lib/components/RegisterForm.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  export let data;
  export let contentItems;
  export let altMethods;
  export let onSubmit;
  export let loading;
  export let error;
  export let successMessage;
  export let username;
  export let email;
  export let password;
  export let passwordRepeat;
  export let agreement;
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
