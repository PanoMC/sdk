<svelte:head>
  {#if !provides.bootstrap}
    <link rel="stylesheet" href="{base}/assets/css/pano-tokens.css" />
  {/if}
  {#each [...styles.keys] as key (key)}
    {@const href = fallbackHref(key, plugins, base)}
    {#if href}
      <link rel="stylesheet" {href} data-pano-fb-style={key} />
    {/if}
  {/each}
</svelte:head>

<script>
  // The stylesheet links of the fallback styles (doc 03 section 4.4), rendered by `RootLayout.svelte` AFTER the page.
  //
  // This is a component of its own, not a `<svelte:head>` in RootLayout, because the Svelte compiler emits the code
  // of a `<svelte:head>` before the rest of its component's markup: on the server a head in RootLayout would list the
  // keys before any view had rendered and so before any view had asked for its sheet. A child component runs where
  // it is placed, after the slot, when the server has collected every key.
  //
  // A theme that provides Bootstrap gets no tokens link and only the `own:` links (and `icons` when it has no
  // Font Awesome); a theme without Bootstrap gets `pano-tokens.css` first.
  import { base } from "$app/paths";
  import { fallbackHref } from "$pano/lib/fallbackStyles.js";

  /** @type {{ styles: { keys: Set<string> }, plugins: Record<string, any>, provides: { bootstrap: boolean } }} */
  let { styles, plugins, provides } = $props();
</script>
