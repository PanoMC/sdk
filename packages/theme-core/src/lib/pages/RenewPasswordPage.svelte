<svelte:component
  this={data.View}
  {data}
  {error}
  {message}
  {loading}
  {newPassword}
  {newPasswordRepeat}
  {renewPasswordContentItems}
  {onSubmit} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/RenewPasswordPageLogics";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').PageLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "RenewPasswordView",
      () => import("../views/RenewPasswordView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
  }
</script>

<script>
  import { writable } from "svelte/store";

  import { onSubmit } from "$pano/lib/ui-logics/page-logics/RenewPasswordPageLogics";
  import { panoApiClient } from "$pano/lib/PluginAPI";

  export let data;

  const renewPasswordContentItems = panoApiClient.ui.auth.renewPassword.content.get();

  let error = writable();
  let message = writable();
  let loading = writable();
  let newPassword = writable("");
  let newPasswordRepeat = writable("");
</script>
