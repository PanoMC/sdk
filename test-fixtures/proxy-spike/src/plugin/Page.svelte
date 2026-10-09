<script>
  import Child from './Child.proxy.js';
  import Badge from './Badge.proxy.js';
  import { readSession } from './session.js';

  let { title = 'Page' } = $props();

  const session = readSession();
</script>

<section class="page">
  <h1>{title}</h1>
  <p class="page-user">page:{session.user ?? 'guest'}</p>
  <Child label="one" />
  <Badge text="page-badge" />
  {#if session.user}<span class="logged">in</span>{:else}<span class="logged">out</span>{/if}
</section>
