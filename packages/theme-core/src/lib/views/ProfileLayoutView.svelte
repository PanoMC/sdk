<!--
  @view ProfileLayoutView
  Controller: $pano/lib/layouts/ProfileLayout.svelte
  Props:
    data  object — layout load data from processLoad (ProfileLayoutLogics)
  Slot:
    default — the profile page content forwarded by the controller
  Override from a theme:
    theme.config.js → views: { ProfileLayoutView: () => import("./src/views/ProfileLayoutView.svelte") }
-->
<!-- Profile Layout -->
<slot />

<script>
  export let data;
</script>
