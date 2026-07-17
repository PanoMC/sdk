<!--
  @view CreateTicketView
  Controller: $pano/lib/pages/ticket/CreateTicketPage.svelte
  Props:
    data        object — page data (categories, sidebar, pageTitle, View)
    error       writable store — submit error shown by ErrorAlert
    title       writable store — ticket title field value
    message     writable store — ticket message textarea value
    categoryId  writable store — selected category id (-1 = no category)
    loading     writable store — request in-flight flag
    submit      function — (error, loading, title, message, categoryId) sends the create-ticket request
  Override from a theme:
    theme.config.js → views: { CreateTicketView: () => import("./src/views/CreateTicketView.svelte") }
-->
<style>
  #ticketTitle {
    margin-bottom: -2px;
  }

  #ticketTitle:focus {
    position: relative;
    z-index: 2;
  }
</style>

<script>
  import { _ } from "svelte-i18n";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";

  export let data;
  export let error;
  export let title;
  export let message;
  export let categoryId;
  export let loading;
  export let submit;

  $: isButtonDisabled = $title === "" || $message === "";
</script>

<div class="vstack gap-3">
  <ErrorAlert error={$error} />
  <div class="vstack gap-0">
    <input
      id="ticketTitle"
      type="text"
      class="form-control form-control-lg rounded-bottom-0"
      placeholder={$_("pages.create-ticket.inputs.title")}
      bind:value={$title} />

    <select
      class="form-select form-select-lg rounded-top-0"
      id="datalistOptions"
      bind:value={$categoryId}>
      <option value={-1}>{$_("pages.create-ticket.inputs.no-category")}</option>
      {#each data.categories as category, index (category)}
        <option value={category.id}>{category.title}</option>
      {/each}
    </select>
  </div>

  <!-- Ticket Editor -->

  <textarea bind:value={$message} class="form-control" rows="6"></textarea>

  <button
    class="btn btn-lg btn-secondary w-100"
    class:disabled={$loading || isButtonDisabled}
    disabled={$loading || isButtonDisabled}
    on:click={() => submit(error, loading, title, message, categoryId)}>
    {$_("buttons.create-ticket")}</button>
</div>
