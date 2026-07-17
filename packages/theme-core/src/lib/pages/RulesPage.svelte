<div class="vstack gap-3">
  <div class="alert alert-secondary mb-0" role="alert">
    <i class="fas fa-gavel me-2"></i>
    {$_("pages.rules.warning")}
  </div>

  <div class="card">
    <div class="card-body">
      {@html data.registerAgreement}
    </div>
  </div>
</div>

<!-- Pagination End -->
<script context="module">
  import { error } from "@sveltejs/kit";

  import ApiUtil from "$pano/lib/api.util";

  /**
   * @type {import("@sveltejs/kit").PageLoad}
   */
  export async function load(event) {
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

    return { ...parentData, pageTitle: "pages.rules.title", registerAgreement };
  }
</script>

<script>
  import { _ } from "svelte-i18n";

  export let data;
</script>
