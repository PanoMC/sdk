<svelte:component this={data.View} {data} />

<script context="module">
  import { error } from "@sveltejs/kit";

  import ApiUtil from "$pano/lib/api.util";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import("@sveltejs/kit").PageLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "RulesView",
      () => import("../views/RulesView.svelte"),
    );

    const parentData = await event.parent();
    const session = parentData.session;

    if (!session.siteInfo.hasRegisterAgreement) {
      throw error(404);
    }

    const csrfToken = session.csrfToken;
    let registerAgreement;
    try {
      const body = await ApiUtil.get({
        path: "/api/registerAgreement",
        request: event,
        csrfToken
      });
      registerAgreement = body.registerAgreement;
    } catch (_e) {
      throw error(404);
    }

    return {
      ...parentData,
      pageTitle: "pages.rules.title",
      registerAgreement,
      View: await viewPromise
    };
  }
</script>

<script>
  export let data;
</script>
