<!--
  Controller of the engine's <DefaultToast>. The markup lives in views/parts/DefaultToast.svelte; a theme may
  replace it with the "DefaultToast" entry of theme.config.js views (see skin-contract.json for the props).
  The message is translated and its values escaped here, so an override cannot forget the escaping.
-->
<svelte:component this={getOverride("DefaultToast") ?? DefaultToastView} {id} {text} {message} {variant} />

<script>
  import { _ } from "svelte-i18n";

  import { escapeValues } from "@panomc/sdk/core/js/html.util.js";

  import { getOverride } from "$pano/registry/index.js";
  import DefaultToastView from "$pano/lib/views/parts/DefaultToast.svelte";

  export let id;
  export let text;
  export let values;
  export let variant = null;

  $: message = $_(text, { values: escapeValues(values) });
</script>
