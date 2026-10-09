<svelte:component
  this={data.View}
  {data}
  {error}
  {successMessage}
  {loading}
  {activateContentItems}
  {verifyEmail} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/ActiveEmailPageLogics.js";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const loadData = await processLoad(event);

    return { ...loadData, ...(await loadView(event, "ActivateEmailView", () => import("../views/ActivateEmailView.svelte"))) };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { writable } from "svelte/store";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import { verifyEmail } from "$pano/lib/ui-logics/page-logics/ActiveEmailPageLogics.js";
  import { panoApiClient } from "$pano/lib/PluginAPI";

  export let data;

  const activateContentItems = panoApiClient.ui.auth.activate.content.get();

  let loading = writable();
  let error = writable();
  let successMessage = writable(null);

</script>
