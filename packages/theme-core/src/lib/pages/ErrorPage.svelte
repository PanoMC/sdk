<div class="vstack gap-3">
  <PageTitle
    title="Hata: 404"
    subtitle={page.status === 404
      ? $_("page-errors.404-description")
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

  import { page } from "$app/state";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";
</script>
