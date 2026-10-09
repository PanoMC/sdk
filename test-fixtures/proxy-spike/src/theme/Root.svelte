<script>
  import { setContext } from 'svelte';

  // A theme root that uses context, like the real RootLayout: the theme copy has a component on its stack.
  let { Page } = $props();

  setContext('pano:probe', 'theme-root');
</script>

<main class="root"><Page title="Home" /></main>
