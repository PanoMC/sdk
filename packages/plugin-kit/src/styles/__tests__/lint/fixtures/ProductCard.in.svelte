<script>
  import { _ } from 'svelte-i18n';

  let { product, add } = $props();
</script>

<div class={['card', 'h-100', { 'is-sold-out': !product.inStock }]}>
  <div class="card-body d-flex flex-column gap-1">
    <h3 class="h6 card-title mb-0 text-truncate">{product.name}</h3>
    <a class="btn btn-outline-secondary btn-sm w-100" href={product.url}>{$_('theme.store.details')}</a>
    <button class="btn btn-primary btn-sm w-100" onclick={add}>{$_('theme.store.addToCart')}</button>
  </div>
</div>
