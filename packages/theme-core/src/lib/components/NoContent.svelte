<div class="border-0 opacity-25 bg-transparent">
  <div class="vstack gap-3 text-center py-2">
    <span class={icon}></span>
    {#if text}
      <p class="mb-0">{text}</p>
    {/if}
    <slot />
  </div>
</div>

<script>
  import { _ } from "svelte-i18n";

  export let icon = "fa-regular fa-square fa-3x";
  export let text = $_("components.no-content.text");
</script>
