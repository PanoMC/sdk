<style>
  #lfb-usernameOrEmail, #lfb-password {
    margin-bottom: -1px;
  }

  #lfb-usernameOrEmail:focus, #lfb-password:focus {
    position: relative;
    z-index: 2;
  }
</style>

<script>
  import { _ } from "svelte-i18n";

  import { stripIdentifierWhitespace } from "$pano/lib/loginInput.util.js";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  export let usernameOrEmail = "";
  export let password = "";
  export let loading = false;
  export let usernameDisabled = false;
  export let submitLabel = null;

  function onUsernameInput() {
    const c = stripIdentifierWhitespace(usernameOrEmail);
    if (c !== usernameOrEmail) {
      usernameOrEmail = c;
    }
  }

  // Plugin-contributed login fields (e.g. auth-guard captcha) appear inline in the form, exactly
  // as they do on the theme's /login page. The "login-form" item is the marker the theme uses to
  // place its own form in the slot order — we don't render it ourselves.
  const contentItems = panoApiClient.ui.auth.login.content.get();
</script>

<div class="form-group">
  <div class="form-floating">
    <input
      bind:value={usernameOrEmail}
      class="form-control rounded-bottom-0"
      id="lfb-usernameOrEmail"
      on:input={onUsernameInput}
      disabled={loading || usernameDisabled}
      type="text" />
    <label for="lfb-usernameOrEmail">
      {$_("components.modals.login.inputs.username-email")}
    </label>
  </div>

  <div class="form-floating">
    <input
      bind:value={password}
      class="form-control rounded-top-0"
      id="lfb-password"
      disabled={loading}
      type="password" />
    <label for="lfb-password">
      {$_("components.modals.login.inputs.password")}
    </label>
  </div>
</div>

{#each $contentItems as item (item.id)}
  {#if item.id !== 'login-form' && item.component && (item.priority || 0) < 100}
    <ViewComponent component={item.component} data={{ pageType: 'login' }} />
  {/if}
{/each}

<slot name="beforeSubmit" />

<div class="vstack gap-2">
  <button
    class="btn btn-lg btn-secondary"
    class:disabled={loading || !usernameOrEmail || !password}
    disabled={loading || !usernameOrEmail || !password}
    type="submit">
    {#if loading}
      <span
        class="spinner-border spinner-border-sm me-2"
        role="status"
        aria-label="Loading"></span>
      <span>{submitLabel || $_("buttons.login")}...</span>
    {:else}
      {submitLabel || $_("buttons.login")}
    {/if}
  </button>
  <slot name="footer" />
</div>
