<div hidden="{$hidden}">
  <slot />
</div>

<script context="module">
  import { processLoadServer, processLoad } from "$pano/lib/ui-logics/layout-logics/ThemeSettingsLayoutLogics";

  export async function loadServer(event) {
    return await processLoadServer(event);
  }

  export async function load(event) {
    return await processLoad(event);
  }
</script>

<script>
  import { init } from "$pano/lib/ui-logics/layout-logics/ThemeSettingsLayoutLogics";

  const hidden = init();
</script>
