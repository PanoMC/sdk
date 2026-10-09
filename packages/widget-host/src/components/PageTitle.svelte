<script>
  // `title` is a string, or a snippet when the caller used the named slot `title` (legacy slot syntax compiles to a prop).
  let { title = '', subtitle = '', html, subtitleHtml = false, children } = $props();

  const custom = $derived(typeof title === 'function');
</script>

{#if title || subtitle}
  <div class="text-center">
    <h1 class="fs-3 mb-0 text-break word-break">
      {#if custom}
        {@render title()}
      {:else if title}
        {#if html}
          {@html title}
        {:else}
          {title}
        {/if}
      {/if}
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
    {@render children?.()}
  </div>
{/if}
