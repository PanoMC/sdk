<!--
  @view ResetPasswordView
  Controller: $pano/lib/pages/ResetPasswordPage.svelte
  Props:
    data                       object — merged page data (session, pageTitle, View)
    error                      writable store — error code rendered by ErrorAlert
    message                    writable store — success message code rendered by SuccessAlert
    loading                    writable store — true while the reset request is in flight
    usernameOrEmail            writable store — bound value of the email/username input
    resetPasswordContentItems  readable store — plugin-registered content items rendered inside the form
    onSubmit                   function(error, message, loading, usernameOrEmail) — sends the reset-password request
    stripIdentifierWhitespace  function(value) — strips whitespace from the typed identifier
  Override from a theme:
    theme.config.js → views: { ResetPasswordView: () => import("./src/views/ResetPasswordView.svelte") }
-->
<div class="vstack gap-3">

  <ErrorAlert error={$error} />
  <SuccessAlert message={$message} />
  <form
    onsubmit={(e) => {
      e.preventDefault();
      onSubmit(error, message, loading, usernameOrEmail);
    }}>
    <div class="vstack gap-3">
      <div class="form-floating">
        <input
          type="text"
          disabled={$loading}
          placeholder={$_(
            "pages.reset-password.inputs.email-username.placeholder",
          )}
          id="email"
          class="form-control"
          bind:value={$usernameOrEmail}
          oninput={() => {
            const c = stripIdentifierWhitespace($usernameOrEmail);
            if (c !== $usernameOrEmail) {
              usernameOrEmail.set(c);
            }
          }} />
        <label for="email"
          >{$_(
            "pages.reset-password.inputs.email-username.placeholder",
          )}</label>
      </div>
      {#each $resetPasswordContentItems as item (item.id)}
        {#if item.component}
          <ViewComponent
            component={item.component}
            data={{ pageType: 'reset-password' }} />
        {/if}
      {/each}
      <button
        type="submit"
        class="btn btn-lg btn-secondary w-100"
        class:disabled={$loading || !$usernameOrEmail}
        disabled={$loading || !$usernameOrEmail}>
        {#if $loading}
          <span
            class="spinner-border spinner-border-sm me-2"
            role="status"
            aria-label="Loading"></span>
          <span>{$_("buttons.reset-password")}...</span>
        {:else}
          {$_("buttons.reset-password")}
        {/if}
      </button>
    </div>
  </form>
</div>

<script>
  import { _ } from "svelte-i18n";

  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";
  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import SuccessAlert from "$pano/lib/components/SuccessAlert.svelte";

  export let data;
  export let error;
  export let message;
  export let loading;
  export let usernameOrEmail;
  export let resetPasswordContentItems;
  export let onSubmit;
  export let stripIdentifierWhitespace;
</script>
