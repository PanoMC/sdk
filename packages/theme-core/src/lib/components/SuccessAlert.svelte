{#if message || alwaysVisible}
  <div class="alert alert-primary mb-0" in:fade out:fade>
    {$_('successes.' + (message.key || message), { values: message.props })}
  </div>
{/if}

<script>
  import { fade } from "svelte/transition";
  import { _ } from "svelte-i18n";

  export let message;

  const alwaysVisible = false;
</script>
