<script>
  import { getContext } from 'svelte';

  // This getContext is the plugin bundle's own Svelte copy. It cannot see a context set by a theme component.
  let result;

  try {
    result = `ctx:${getContext('pano:probe') ?? 'none'}`;
  } catch (e) {
    result = `threw:${e?.code ?? e?.message ?? 'error'}`;
  }
</script>

<i class="probe">{result}</i>
