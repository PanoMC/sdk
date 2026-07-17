<svelte:component
  this={data.View}
  {data}
  {error}
  {message}
  {loading}
  {usernameOrEmail}
  {resetPasswordContentItems}
  {onSubmit}
  {stripIdentifierWhitespace} />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/ResetPasswordPageLogics";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import('@sveltejs/kit').LayoutLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "ResetPasswordView",
      () => import("../views/ResetPasswordView.svelte"),
    );

    const loadData = await processLoad(event);

    return { ...loadData, View: await viewPromise };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { writable } from "svelte/store";
  import { page } from "$app/stores";

  import { onSubmit } from "$pano/lib/ui-logics/page-logics/ResetPasswordPageLogics";
  import { panoApiClient } from "$pano/lib/PluginAPI";

  import { stripIdentifierWhitespace } from "$pano/lib/loginInput.util.js";

  const resetPasswordContentItems = panoApiClient.ui.auth.resetPassword.content.get();

  const error = writable();
  const message = writable();
  const loading = writable();
  const usernameOrEmail = writable("");

  // The route shim renders <ResetPasswordPage /> without forwarding `data`
  // (sync.js pagePair props: "none"), so read the merged page data from the
  // page store instead of a prop.
  $: data = $page.data;
</script>
