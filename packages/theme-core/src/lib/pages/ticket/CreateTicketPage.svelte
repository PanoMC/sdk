<style>
  #ticketTitle {
    margin-bottom: -2px;
  }

  #ticketTitle:focus {
    position: relative;
    z-index: 2;
  }
</style>

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

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/CreateTicketPageLogics.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    return processLoad(event);
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { writable } from "svelte/store";
  import { _ } from "svelte-i18n";

  import { submit } from "$pano/lib/ui-logics/page-logics/CreateTicketPageLogics";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";

  export let data;

  let error = writable();
  let title = writable("");
  let message = writable("");
  let categoryId = writable(-1);
  let loading = writable(false);

  $: isButtonDisabled = $title === "" || $message === "";
</script>
