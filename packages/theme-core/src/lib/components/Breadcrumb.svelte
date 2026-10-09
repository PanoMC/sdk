<!--
  Controller of the engine's <Breadcrumb>. The markup lives in views/parts/Breadcrumb.svelte; a theme may
  replace it with the "Breadcrumb" entry of theme.config.js views (see skin-contract.json for the props).
-->
<svelte:component this={getOverride("Breadcrumb") ?? BreadcrumbView} {items} />

<script>
  import { getContext } from "svelte";
  import { _ } from "svelte-i18n";

  import { getOverride } from "$pano/registry/index.js";
  import BreadcrumbView from "$pano/lib/views/parts/Breadcrumb.svelte";

  /**
   * Breadcrumb items are supplied manually by pages via the `breadcrumbs`
   * key returned from their load() function. When a page doesn't provide
   * `breadcrumbs`, the component renders nothing.
   *
   * Each item can be either:
   *   - A string: treated as an i18n translation key.
   *   - An object with shape:
   *       {
   *         label: string,              // i18n key, or raw text if raw=true
   *         labelValues?: object,       // i18n interpolation values
   *         href?: string,              // makes the item a link
   *         icon?: string,              // e.g. "fas fa-home"
   *         raw?: boolean,              // bypass i18n, use label as-is
   *         html?: boolean              // render label as HTML (raw implied)
   *       }
   *
   * The last item is always treated as the active/current page.
   */

  const breadcrumbsStore = getContext("breadcrumbs");

  function resolveLabel(item) {
    if (item == null) return "";
    if (typeof item === "string") return $_(item);
    if (item.raw || item.html) return item.label ?? "";
    if (!item.label) return "";
    return $_(item.label, { values: item.labelValues || {} });
  }

  function normalize(item) {
    if (typeof item === "string") {
      return { label: resolveLabel(item) };
    }
    return {
      label: resolveLabel(item),
      href: item?.href,
      icon: item?.icon,
      html: !!item?.html
    };
  }

  $: items = Array.isArray($breadcrumbsStore) ? $breadcrumbsStore.map(normalize) : [];
</script>
