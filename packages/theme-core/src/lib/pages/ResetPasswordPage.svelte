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

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/ResetPasswordPageLogics";

  /**
   * @type {import('@sveltejs/kit').LayoutLoad}
   */
  export async function load(event) {
    return await processLoad(event);
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { writable } from "svelte/store";
  import { _ } from "svelte-i18n";

  import { onSubmit } from "$pano/lib/ui-logics/page-logics/ResetPasswordPageLogics";
  import { panoApiClient } from "$pano/lib/PluginAPI";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  import { stripIdentifierWhitespace } from "$pano/lib/loginInput.util.js";
  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import SuccessAlert from "$pano/lib/components/SuccessAlert.svelte";

  const resetPasswordContentItems = panoApiClient.ui.auth.resetPassword.content.get();

  const error = writable();
  const message = writable();
  const loading = writable();
  const usernameOrEmail = writable("");

</script>
