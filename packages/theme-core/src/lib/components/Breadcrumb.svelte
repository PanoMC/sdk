<script>
  import { getContext } from "svelte";
  import { _ } from "svelte-i18n";

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

{#if items.length > 0}
  <nav aria-label="breadcrumb">
    <ol class="breadcrumb justify-content-center mb-0">
      {#each items as crumb, i}
        {@const isLast = i === items.length - 1}
        <li
          class="breadcrumb-item"
          class:active={isLast}
          aria-current={isLast ? "page" : undefined}>
          {#if isLast || !crumb.href}
            {#if crumb.icon}
              <i class={crumb.icon}></i>
            {:else if crumb.html}
              {@html crumb.label}
            {:else}
              {crumb.label}
            {/if}
          {:else}
            <a href={crumb.href} class="text-decoration-none badge text-bg-primary rounded-pill px-1">
              {#if crumb.icon}
                <i class={crumb.icon}></i>
              {:else if crumb.html}
                {@html crumb.label}
              {:else}
                {crumb.label}
              {/if}
            </a>
          {/if}
        </li>
      {/each}
    </ol>
  </nav>
{/if}

<style>
  .breadcrumb {
    --bs-breadcrumb-divider: "•";
  }
</style>
