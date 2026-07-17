<!--
  @view ActivateEmailView
  Controller: $pano/lib/pages/ActivateEmailPage.svelte
  Props:
    data                  object — page data (data.token: e-mail activation token from the URL)
    error                 writable store — error code rendered by ErrorAlert (e.g. "INVALID_LINK")
    successMessage        writable store — success code rendered by SuccessAlert ("VALIDATION_SUCCESSFUL")
    loading               writable store — true while the verification request is in flight
    activateContentItems  readable store — plugin-injected content items for the activate page
    verifyEmail           function(error, successMessage, loading, data) — runs the e-mail verification request
  Override from a theme:
    theme.config.js → views: { ActivateEmailView: () => import("./src/views/ActivateEmailView.svelte") }
-->
<div class="col-lg-4 col-md-6 mx-auto">
  <div class="vstack gap-3">

    <div class="card">
      <div class="card-body">
        <div class="vstack gap-3">
          <img
            alt="Allay"
            class="d-block mx-auto"
            src="https://cdn3.emoji.gg/emojis/8182-allay-dancing.gif" />
          <ErrorAlert error={$error} />
          <SuccessAlert message={$successMessage} />
          {#each $activateContentItems as item (item.id)}
            {#if item.component}
              <ViewComponent
                component={item.component}
                data={{ pageType: 'activate' }} />
            {/if}
          {/each}
          <button
            class="btn btn-secondary w-100"
            class:disabled={$loading ||
              $error === "INVALID_LINK" ||
              $successMessage !== null}
            disabled={$loading ||
              $error === "INVALID_LINK" ||
              $successMessage !== null}
            on:click={() => verifyEmail(error, successMessage, loading, data)}>
            {#if $loading}
              <span
                class="spinner-border spinner-border-sm me-2"
                role="status"
                aria-label="Loading"></span>
              <span>{$_("buttons.activate-email")}...</span>
            {:else}
              {$_("buttons.activate-email")}
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
  import { _ } from "svelte-i18n";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import SuccessAlert from "$pano/lib/components/SuccessAlert.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  export let data;
  export let error;
  export let successMessage;
  export let loading;
  export let activateContentItems;
  export let verifyEmail;
</script>
