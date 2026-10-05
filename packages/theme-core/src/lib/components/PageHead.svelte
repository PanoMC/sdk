<!--
  Engine component (not overridable): the page head metadata of a page.
  Fed by AppLayout with the page's `meta` load result, the site info, the page URL and the
  resolved page title (no site suffix). Every tag is emitted only when its value is non-null.
-->
<svelte:head>
  {#if head.description}
    <meta name="description" content={head.description} />
  {/if}
  {#if head.ogTitle}
    <meta property="og:title" content={head.ogTitle} />
  {/if}
  {#if head.ogDescription}
    <meta property="og:description" content={head.ogDescription} />
  {/if}
  <meta property="og:type" content={head.ogType} />
  {#if head.ogUrl}
    <meta property="og:url" content={head.ogUrl} />
  {/if}
  {#if head.siteName}
    <meta property="og:site_name" content={head.siteName} />
  {/if}
  {#if head.ogImage}
    <meta property="og:image" content={head.ogImage} />
    {#if head.ogImageAlt}
      <meta property="og:image:alt" content={head.ogImageAlt} />
    {/if}
  {/if}
  <meta name="twitter:card" content={head.twitterCard} />
  {#if head.canonical}
    <link rel="canonical" href={head.canonical} />
  {/if}
  {#if head.robots}
    <meta name="robots" content={head.robots} />
  {/if}
  {#if head.referrer}
    <meta name="referrer" content={head.referrer} />
  {/if}
  {#if head.jsonLd}
    {@html '<script type="application/ld+json">' + head.jsonLd + '</' + 'script>'}
  {/if}
</svelte:head>

<script>
  import { normalizePageMeta } from "$pano/lib/pageMeta.util.js";

  let { meta = undefined, siteInfo = undefined, url = undefined, title = undefined } = $props();

  const head = $derived(normalizePageMeta(meta, { siteInfo, url, title }));
</script>
