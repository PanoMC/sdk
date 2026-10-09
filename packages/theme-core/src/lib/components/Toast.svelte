<!--
  Controller of the engine's <Toast>. The markup lives in views/parts/Toast.svelte; a theme may
  replace it with the "Toast" entry of theme.config.js views (see skin-contract.json for the props).
-->
<svelte:component this={getOverride("Toast") ?? ToastView} {id} {variant} {variantClass}>
  <slot />
</svelte:component>

<script>
  import { getOverride } from "$pano/registry/index.js";
  import ToastView from "$pano/lib/views/parts/Toast.svelte";

  export let id;

  // 'success' | 'danger' | 'warning' | null. Mapped instead of interpolated straight into the
  // class list so a caller can't inject an arbitrary utility class, and so a neutral toast
  // keeps text-bg-tertiary's own contrast colour.
  export let variant = null;

  const VARIANT_CLASSES = {
    success: "text-success",
    danger: "text-danger",
    warning: "text-warning",
  };

  $: variantClass = VARIANT_CLASSES[variant] ?? "";
</script>
