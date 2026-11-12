<svelte:component
  this={data.View}
  data={viewData}
  {error}
  {title}
  {message}
  {categoryId}
  {loading}
  submit={submitWithFields} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/CreateTicketPageLogics.js";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const result = await processLoad(event);

    return { ...result, ...(await loadView(event, "CreateTicketView", () => import("../../views/CreateTicketView.svelte"))) };
  }
</script>

<script>
  import { getContext, onMount, setContext } from "svelte";
  import { writable } from "svelte/store";
  import { locale } from "svelte-i18n";

  import { submit } from "$pano/lib/ui-logics/page-logics/CreateTicketPageLogics";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import { TICKET_FIELDS_CONTEXT } from "$pano/lib/ticketFields.js";
  import { localizeCategories } from "$pano/lib/contentI18n.js";

  export let data;

  // The view gets the categories (titles, descriptions, field texts) in the site's current language;
  // switching the language re-renders them.
  $: viewData = { ...data, categories: localizeCategories(data.categories, $locale) };

  let error = writable();
  let title = writable("");
  let message = writable("");
  // Where a ticket must have a category the form starts on the first one, not on "no category".
  let categoryId = writable(
    data.allowNoCategory === false && data.categories?.length ? data.categories[0].id : -1,
  );
  let loading = writable(false);

  // The chosen category's custom fields: <TicketFieldsForm> (inside the view) fills these through the
  // context; the view's submit call keeps its signature and the fields ride along.
  const fieldValues = writable({});
  const fieldErrors = writable({});

  setContext(TICKET_FIELDS_CONTEXT, { values: fieldValues, errors: fieldErrors });

  /** Same signature as `submit` (the view passes its stores), plus the custom fields. */
  const submitWithFields = (error, loading, title, message, categoryId) =>
    submit(error, loading, title, message, categoryId, {
      categories: data.categories,
      values: fieldValues,
      errors: fieldErrors,
    });
</script>
