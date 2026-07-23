{#if error || alwaysVisible}
  {@const errorKey = error.key || error}
  <div class="alert alert-danger" in:fade out:fade>
    {$_(errorKey.includes('.') ? errorKey : 'errors.' + errorKey, { values: error.props })}
  </div>
{/if}

<script>
  import { fade } from "svelte/transition";
  import { _ } from "svelte-i18n";

  export let error;

  const alwaysVisible = false;
</script>
  