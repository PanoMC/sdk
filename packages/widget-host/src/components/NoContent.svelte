<script>
  import { translate } from '../language.js';

  let { icon = 'fa-solid fa-square fa-3x', text = translate('components.no-content.text', 'No content'), children } = $props();
</script>

<div class="card opacity-50 bg-transparent border-none">
  <div class="card-body vstack gap-3 text-center">
    <span class={icon}></span>
    <p class="mb-0">{text}</p>
    {@render children?.()}
  </div>
</div>
