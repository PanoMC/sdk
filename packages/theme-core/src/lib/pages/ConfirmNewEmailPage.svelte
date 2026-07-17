<svelte:component
  this={data.View}
  {data}
  {activateNewEmailContentItems}
  {loading}
  {error}
  {successMessage}
  {verifyEmail} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/ConfirmNewEmailPageLogics";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "ConfirmNewEmailView",
      () => import("../views/ConfirmNewEmailView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { writable } from "svelte/store";

  import { verifyEmail } from "$pano/lib/ui-logics/page-logics/ConfirmNewEmailPageLogics";

  import { panoApiClient } from "$pano/lib/PluginAPI";

  export let data;

  const activateNewEmailContentItems = panoApiClient.ui.auth.activateNewEmail.content.get();

  let loading = writable();
  let error = writable();
  let successMessage = writable(null);

</script>
