<svelte:component this={data.View} {data} />

<script context="module">
  import { error } from "@sveltejs/kit";

  import ApiUtil from "$pano/lib/api.util";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import("@sveltejs/kit").PageLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const parentData = await event.parent();
    const session = parentData.session;

    if (!session.siteInfo.hasRegisterAgreement) {
      throw error(404);
    }

    const csrfToken = session.csrfToken;
    let registerAgreement;
    try {
      const body = await ApiUtil.get({
        path: "/register-agreement",
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
      ...(await loadView(event, "RulesView", () => import("../views/RulesView.svelte")))
    };
  }
</script>

<script>
  export let data;
</script>
