<!--
  @view ThemeSettingsLayoutView
  Controller: $pano/lib/layouts/ThemeSettingsLayout.svelte
  Props:
    data    object — layout load data from processLoad (ThemeSettingsLayoutLogics)
    hidden  store<boolean> — whether the layout content is hidden (from ThemeSettingsLayoutLogics init)
  Slot:
    default — the theme settings page content forwarded by the controller
  Override from a theme:
    theme.config.js → views: { ThemeSettingsLayoutView: () => import("./src/views/ThemeSettingsLayoutView.svelte") }
-->
<div hidden="{$hidden}">
  <slot />
</div>

<script>
  export let data;
  export let hidden;
</script>
