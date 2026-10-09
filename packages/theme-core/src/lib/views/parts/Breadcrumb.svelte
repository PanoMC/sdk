<!--
  Default markup of the engine's <Breadcrumb> (registry name "Breadcrumb", contract 1).

  Props:
    items  array - the normalized trail: { label, href?, icon?, html } (label already translated);
           the last item is the current page; an empty array renders nothing
-->
{#if items.length > 0}
  <nav class="pano-breadcrumb" aria-label="breadcrumb">
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
            <a href={publicHref(crumb.href)} class="pano-breadcrumb__badge text-decoration-none badge text-bg-primary rounded-pill px-1">
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

<script>
  // A site path in a trail is a canonical path: the link shows the theme's public one.
  import { publicHref } from "$pano/lib/views/parts/publicHref.js";

  export let items = [];
</script>
