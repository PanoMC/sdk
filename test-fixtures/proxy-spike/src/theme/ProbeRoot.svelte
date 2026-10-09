<script>
  import { setContext } from 'svelte';

  let { Probe } = $props();

  setContext('pano:probe', 'theme-root');
</script>

<main class="root"><Probe /></main>
