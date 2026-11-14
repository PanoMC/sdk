<!--
  Default markup of the engine's <Breadcrumb> (registry name "Breadcrumb", contract 1).

  Props:
    items  array - the normalized trail: { label, href?, icon?, html, variant? } (label already translated);
           variant="bootstrap" uses the plain Bootstrap 5 style; the last item is the current page
-->
{#if items.length > 0}
  <nav
    class={["pano-breadcrumb", bootstrapStyle && "pano-breadcrumb--bootstrap"]}
    aria-label="breadcrumb">
    <ol class={bootstrapStyle ? "breadcrumb" : "breadcrumb justify-content-center mb-0"}>
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
            <a
              href={publicHref(crumb.href)}
              class={bootstrapStyle
                ? undefined
                : "pano-breadcrumb__badge text-decoration-none badge text-bg-primary rounded-pill px-1"}>
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
  .pano-breadcrumb:not(.pano-breadcrumb--bootstrap) .breadcrumb {
    --bs-breadcrumb-divider: "•";
  }
</style>

<script>
  // A site path in a trail is a canonical path: the link shows the theme's public one.
  import { publicHref } from "$pano/lib/views/parts/publicHref.js";

  export let items = [];
  $: bootstrapStyle = items.some((item) => item.variant === "bootstrap");
</script>
