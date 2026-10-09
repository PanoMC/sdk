<script>
  import { setContext } from 'svelte';

  /** @type {{ Component: any, ns: string, mode: 'fallback'|'stop', props: object }} */
  let { Component, ns, mode, props } = $props();

  setContext('pano:fb', mode === 'fallback' ? ns : null);
</script>

<div
  class={mode === 'fallback' ? 'pano-fb' : 'pano-fb-stop'}
  data-pano-fb={mode === 'fallback' ? ns : undefined}
  style="display: contents"
>
  <Component {...props} />
</div>
