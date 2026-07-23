<div class="card opacity-50 bg-transparent border-none">
  <div class="card-body vstack gap-3 text-center">
    <span class={icon}></span>
    <p class="mb-0">{text}</p>
    <slot />
  </div>
</div>

<script>
  import { _ } from "svelte-i18n";

  export let icon = "fa-solid fa-square fa-3x";
  export let text = $_("components.no-content.text");
</script>
