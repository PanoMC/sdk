<svelte:component
  this={data.View}
  {data}
  {error}
  {title}
  {message}
  {categoryId}
  {loading}
  {submit} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/CreateTicketPageLogics.js";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "CreateTicketView",
      () => import("../../views/CreateTicketView.svelte"),
    );

    const result = await processLoad(event);

    return { ...result, View: await viewPromise };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { writable } from "svelte/store";

  import { submit } from "$pano/lib/ui-logics/page-logics/CreateTicketPageLogics";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";

  export let data;

  let error = writable();
  let title = writable("");
  let message = writable("");
  let categoryId = writable(-1);
  let loading = writable(false);
</script>
