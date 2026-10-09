<script>
  import FallbackScope from './FallbackScope.svelte';

  // The theme's plugin-page route: the default page sits in a fallback scope of its plugin (doc 03 section 4.4).
  let { Page } = $props();
</script>

<main class="root">
  <FallbackScope Component={Page} ns="spike" mode="fallback" props={{ title: 'Home' }} />
</main>
