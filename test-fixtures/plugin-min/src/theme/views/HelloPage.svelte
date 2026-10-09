<script module>
  export const view = { path: '/hello' };
</script>

<script>
  import { greet } from '../lib/greet.js';

  let { name = 'Pano' } = $props();
</script>

<h1>{greet(name)}</h1>
