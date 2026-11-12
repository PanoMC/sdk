<svelte:component this={data.View} data={viewData} />

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
    let registerAgreementI18n;
    try {
      const body = await ApiUtil.get({
        path: "/register-agreement",
        request: event,
        csrfToken
      });
      registerAgreement = body.registerAgreement;
      registerAgreementI18n = body.registerAgreementI18n;
    } catch (_e) {
      throw error(404);
    }

    return {
      ...parentData,
      pageTitle: "pages.rules.title",
      registerAgreement,
      registerAgreementI18n,
      ...(await loadView(event, "RulesView", () => import("../views/RulesView.svelte")))
    };
  }
</script>

<script>
  import { locale } from "svelte-i18n";

  import { localizedString } from "$pano/lib/contentI18n.js";

  export let data;

  // The agreement in the site's current language (`registerAgreementI18n`: locale code -> html).
  $: viewData = {
    ...data,
    registerAgreement: localizedString(data.registerAgreement, data.registerAgreementI18n, $locale),
  };
</script>
