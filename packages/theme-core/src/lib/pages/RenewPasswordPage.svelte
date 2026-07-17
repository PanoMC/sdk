<div class="col-lg-4 col-md-6 m-auto">
  <div class="card">
    <div class="card-body">
      <h5 class="card-title">{$_("pages.renew-password.title")}</h5>
      <ErrorAlert error={$error} />
      <SuccessAlert message={$message} />
      <form
        on:submit|preventDefault={() =>
          onSubmit(
            error,
            message,
            loading,
            newPassword,
            newPasswordRepeat,
            data,
          )}>
        <div class="vstack gap-3">
          <div class="input-group">
            <div class="form-floating">
              <input
                type="password"
                id="newPassword"
                class="form-control"
                disabled={$loading}
                bind:value={$newPassword} />
              <label for="newPassword"
                >{$_("pages.renew-password.inputs.new-password")}</label>
            </div>
            <div class="form-floating">
              <input
                type="password"
                id="newPasswordRepeat"
                class="form-control"
                disabled={$loading}
                bind:value={$newPasswordRepeat} />
              <label for="newPasswordRepeat"
                >{$_("pages.renew-password.inputs.new-password-repeat")}</label>
            </div>
          </div>
          {#each $renewPasswordContentItems as item (item.id)}
            {#if item.component}
              <ViewComponent
                component={item.component}
                data={{ pageType: 'renew-password' }} />
            {/if}
          {/each}
          <button
            type="submit"
            class="btn btn-lg btn-secondary w-100"
            class:disabled={$loading}
            disabled={$loading}>
            {#if $loading}
              <span
                class="spinner-border spinner-border-sm me-2"
                role="status"
                aria-label="Loading"></span>
              <span>{$_("buttons.change-password")}...</span>
            {:else}
              {$_("buttons.change-password")}
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
</div>

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/RenewPasswordPageLogics";

  /**
   * @type {import('@sveltejs/kit').PageLoad}
   */
  export async function load(event) {
    return await processLoad(event);
  }
</script>

<script>
  import { _ } from "svelte-i18n";
  import { writable } from "svelte/store";

  import { onSubmit } from "$pano/lib/ui-logics/page-logics/RenewPasswordPageLogics";
  import { panoApiClient } from "$pano/lib/PluginAPI";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import SuccessAlert from "$pano/lib/components/SuccessAlert.svelte";

  export let data;

  const renewPasswordContentItems = panoApiClient.ui.auth.renewPassword.content.get();

  let error = writable();
  let message = writable();
  let loading = writable();
  let newPassword = writable("");
  let newPasswordRepeat = writable("");
</script>
