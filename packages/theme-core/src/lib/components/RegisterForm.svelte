<style>
  #registerUserName, #registerPassword {
    margin-bottom: -1px;
  }

  #registerUserName:focus,
  #registerEmail:focus,
  #registerPassword:focus,
  #registerPasswordRepeat:focus {
    position: relative;
    z-index: 2;
  }
</style>

<script>
  import { getContext } from "svelte";
  import { _ } from "svelte-i18n";

  import { stripIdentifierWhitespace } from "$pano/lib/loginInput.util.js";

  export let username = "";
  export let email = "";
  export let password = "";
  export let passwordRepeat = "";
  export let agreement = false;
  export let loading = false;
  export let usernameDisabled = false;

  const session = getContext("session");

  function onUsernameInput() {
    const c = stripIdentifierWhitespace(username);
    if (c !== username) {
      username = c;
    }
  }

  function onEmailInput() {
    const c = stripIdentifierWhitespace(email);
    if (c !== email) {
      email = c;
    }
  }
</script>

<div class="form-group">
  <div class="form-floating">
    <input
      bind:value={username}
      class="form-control rounded-bottom-0"
      disabled={loading || usernameDisabled}
      id="registerUserName"
      on:input={onUsernameInput}
      type="text" />
    <label for="registerUserName">{$_("components.modals.register.inputs.username")}</label>
  </div>
  <div class="form-floating">
    <input
      bind:value={email}
      class="form-control rounded-top-0"
      disabled={loading}
      id="registerEmail"
      on:input={onEmailInput}
      type="email" />
    <label for="registerEmail">{$_("components.modals.register.inputs.email")}</label>
  </div>
</div>
<div class="form-group">
  <div class="form-floating">
    <input
      bind:value={password}
      class="form-control rounded-bottom-0"
      disabled={loading}
      id="registerPassword"
      type="password" />
    <label for="registerPassword">{$_("components.modals.register.inputs.password")}</label>
  </div>
  <div class="form-floating">
    <input
      bind:value={passwordRepeat}
      class="form-control rounded-top-0"
      disabled={loading}
      id="registerPasswordRepeat"
      type="password" />
    <label for="registerPasswordRepeat">
      {$_("components.modals.register.inputs.password-repeat")}
    </label>
  </div>
</div>
{#if $session.siteInfo.hasRegisterAgreement}
  <div class="form-check">
    <input
      bind:checked={agreement}
      class="form-check-input"
      disabled={loading}
      id="registerAcceptTerms"
      type="checkbox" />
    <label class="form-check-label" for="registerAcceptTerms">
      {@html $_("components.modals.register.inputs.agreement-text", {
        values: {
          link: `<a class="rounded focus-ring" href="/rules">${$_("components.modals.register.inputs.server-rules")}</a>`,
        },
      })}
    </label>
  </div>
{/if}
<slot name="beforeSubmit" />
<div class="vstack gap-2">
  <button
    class="btn btn-lg btn-secondary"
    class:disabled={loading}
    disabled={loading}
    type="submit">
    {#if loading}
      <span
        class="spinner-border spinner-border-sm me-2"
        role="status"
        aria-label="Loading"></span>
      <span>{$_("buttons.register")}...</span>
    {:else}
      {$_("buttons.register")}
    {/if}
  </button>
  <slot name="footer" />
</div>
