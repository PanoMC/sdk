<script>
  import { getContext } from "svelte";

  export let title = "";
  export let subtitle = "";
  export let html;
  export let subtitleHtml = false;

  const themeSettings = getContext("themeSettings");
</script>

{#if title || subtitle}
  <div class="pano-page-title text-center animate__animated animate__fadeIn">
    <h1 class="pano-page-title__title fs-3 mb-0 text-break word-break">
      <slot name="title">
        {#if title}
          {#if html}
            {@html title}
          {:else}
            {title}
          {/if}
        {/if}
      </slot>
    </h1>
    {#if subtitle}
      <p class="mb-0 mt-2 opacity-75">
        {#if subtitleHtml}
          {@html subtitle}
        {:else}
          {subtitle}
        {/if}
      </p>
    {/if}
    <slot />
  </div>
{/if}
