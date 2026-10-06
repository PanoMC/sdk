<span data-fixture={hookName === 'fixture:hook-ssr' ? 'hook-probe-ssr' : 'hook-probe'}>Hook probe rendered</span>

<script>
  // the host `Hook` passes its own name as `hookName`; the two registrations of this component stay distinguishable
  let { hookName = '' } = $props();
</script>
