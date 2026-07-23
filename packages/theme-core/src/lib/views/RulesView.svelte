<!--
  @view RulesView
  Controller: $pano/lib/pages/RulesPage.svelte
  Props:
    data.registerAgreement  string — sanitized HTML of the server's register agreement
  Override from a theme:
    theme.config.js → views: { RulesView: () => import("./src/views/RulesView.svelte") }
-->
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

<script>
  import { _ } from "svelte-i18n";

  export let data;
</script>
