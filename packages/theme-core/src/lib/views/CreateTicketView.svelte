<!--
  @view CreateTicketView
  Controller: $pano/lib/pages/ticket/CreateTicketPage.svelte
  Props:
    data        object — page data (categories, sidebar, pageTitle, View)
    error       writable store — submit error shown by ErrorAlert
    title       writable store — ticket title field value
    message     writable store — ticket message textarea value
    categoryId  writable store — selected category id (-1 = no category); its custom fields render in <TicketFieldsForm>
                (data.categoryEnabled === false: the form has no category choice)
    The form of the chosen category (ticketFormOf from $pano/lib/ticketFields.js) says whether the title
    and the description are asked for and gives their placeholders (empty: the theme's own).
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
  import { onMount } from "svelte";

  import ErrorAlert from "$pano/lib/components/ErrorAlert.svelte";
  import TicketFieldsForm from "$pano/lib/components/TicketFieldsForm.svelte";
  import { ticketFormOf } from "$pano/lib/ticketFields.js";

  let titleInput;

  onMount(() => titleInput?.focus());

  export let data;
  export let error;
  export let title;
  export let message;
  export let categoryId;
  export let loading;
  export let submit;

  $: selectedCategory = (data.categories ?? []).find((category) => String(category.id) === String($categoryId)) ?? null;
  $: categoryShown = data.categoryEnabled !== false;
  $: form = ticketFormOf(data, selectedCategory);
  $: isButtonDisabled = (form.titleEnabled && $title === "") || (form.messageEnabled && $message === "");
</script>

<div class="pano-create-ticket-view vstack gap-3">
  <ErrorAlert error={$error} />
  <div class="vstack gap-0">
    {#if form.titleEnabled}
      <input
        id="ticketTitle"
        type="text"
        class="pano-create-ticket-view__input form-control form-control-lg"
        class:rounded-bottom-0={categoryShown}
        placeholder={form.titlePlaceholder || $_("pages.create-ticket.inputs.title")}
        bind:value={$title}
        bind:this={titleInput} />
    {/if}

    {#if categoryShown}
      <select
        class="pano-create-ticket-view__select form-select form-select-lg"
        class:rounded-top-0={form.titleEnabled}
        id="datalistOptions"
        bind:value={$categoryId}>
        <!-- Offered unless the website asks for a category (the categories answer says so). -->
        {#if data.allowNoCategory !== false}
          <option value={-1}>{$_("pages.create-ticket.inputs.no-category")}</option>
        {/if}
        {#each data.categories as category, index (category)}
          <option value={category.id}>{category.title}</option>
        {/each}
      </select>
    {/if}
  </div>

  <!-- The chosen category's custom fields (nothing when it has none) -->
  <TicketFieldsForm category={selectedCategory} />

  <!-- Ticket Editor -->

  {#if form.messageEnabled}
    <textarea
      bind:value={$message}
      class="pano-create-ticket-view__input-2 form-control"
      placeholder={form.messagePlaceholder || $_("pages.create-ticket.inputs.description")}
      rows="6"></textarea>
  {/if}

  <button
    class="pano-create-ticket-view__action btn btn-lg btn-secondary w-100"
    class:disabled={$loading || isButtonDisabled}
    disabled={$loading || isButtonDisabled}
    on:click={() => submit(error, loading, title, message, categoryId)}>
    {$_("buttons.create-ticket")}</button>
</div>
