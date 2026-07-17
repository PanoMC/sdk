<!--
  @view AuthLayoutView
  Controller: $pano/lib/layouts/AuthLayout.svelte
  Props:
    data  object — layout load data from processLoad (AuthLayoutLogics)
  Slot:
    default — the auth page content forwarded by the controller
  Override from a theme:
    theme.config.js → views: { AuthLayoutView: () => import("./src/views/AuthLayoutView.svelte") }
-->
<style>
  .container {
    max-width: 400px !important;
  }
</style>

<div class="container mx-auto">
  <slot />
</div>

<script>
  export let data;
</script>
