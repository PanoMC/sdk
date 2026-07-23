<!--
  @view ConfirmNewEmailView
  Controller: $pano/lib/pages/ConfirmNewEmailPage.svelte
  Props:
    data                          object — merged load data (token, pageTitle, session, …)
    activateNewEmailContentItems  store<item[]> — plugin-injected content items for the activate-new-email slot
    loading                       writable<boolean> — true while the activation request is in flight
    error                         writable<string|null> — error code shown in the alert (e.g. "INVALID_LINK")
    successMessage                writable<string|null> — success code shown after activation
    verifyEmail                   function — (error, successMessage, loading, data) sends the activation request
  Override from a theme:
    theme.config.js → views: { ConfirmNewEmailView: () => import("./src/views/ConfirmNewEmailView.svelte") }
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
          {#each $activateNewEmailContentItems as item (item.id)}
            {#if item.component}
              <ViewComponent
                component={item.component}
                data={{ pageType: 'activate-new-email' }} />
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
  export let activateNewEmailContentItems;
  export let loading;
  export let error;
  export let successMessage;
  export let verifyEmail;
</script>
