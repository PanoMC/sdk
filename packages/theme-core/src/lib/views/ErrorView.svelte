<!--
  @view ErrorView
  Controller: $pano/lib/pages/ErrorPage.svelte
  Props:
    data  object|undefined — undefined when rendered as +error.svelte (no load runs); kept for the shared controller contract
    page  object — SvelteKit's reactive page state ($app/state); page.status drives the title; page.status / page.error.code pick the 404, chunk-load or internal-error message
  Override from a theme:
    theme.config.js → views: { ErrorView: () => import("./src/views/ErrorView.svelte") }
-->
<div class="vstack gap-3">
  <PageTitle
    title={$_("page-errors.title", { values: { status: page.status }, default: `Error: ${page.status}` })}
    subtitle={page.status === 404
      ? $_("page-errors.404-description")
      : page.error?.code === "MODULE_LOAD_FAILED"
        ? $_("page-errors.assets-failed")
        : $_("errors.INTERNAL_SERVER_ERROR")} />

  <div class="text-center mb-3">
    <img src="/assets/img/404.png" alt="Error" width="256" height="auto" />
  </div>

  <div class="text-center">
    <a href="/" class="btn btn-primary">
      <i class="fas fa-home me-2"></i>
      {$_("nav-links.homepage")}
    </a>
  </div>
</div>

<script>
  import { _ } from "svelte-i18n";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";

  // Part of the shared view contract; undefined when rendered as +error.svelte.
  // svelte-ignore export_let_unused
  export let data = undefined;
  export let page;
</script>
