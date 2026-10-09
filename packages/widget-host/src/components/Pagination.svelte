<script>
  import { createEventDispatcher } from 'svelte';
  import { translate } from '../language.js';

  const dispatch = createEventDispatcher();

  let { page = 1, totalPage = 1 } = $props();

  const pages = $derived(Array.from({ length: totalPage }, (_, i) => i + 1));
  const current = $derived(parseInt(page));
</script>

<nav>
  <ul class="pagination pagination-sm mb-0 justify-content-start flex-wrap">
    <li class="page-item" class:disabled={current === 1}>
      <button
        type="button"
        class="page-link"
        title={translate('components.pagination.previous-page', 'Previous page')}
        onclick={() => dispatch('firstPageClick', {})}
        aria-hidden={current === 1}>
        <i class="fa-solid fa-caret-left"></i>
      </button>
    </li>

    {#each pages as index (index)}
      <li class="page-item" class:active={current === index} aria-current={current === index ? 'page' : undefined}>
        <button
          type="button"
          class="page-link"
          onclick={() => dispatch('pageLinkClick', { page: index })}
          aria-hidden={current === index}>
          {index}
        </button>
      </li>
    {/each}

    <li class="page-item" class:disabled={current === totalPage}>
      <button
        type="button"
        class="page-link"
        title={translate('components.pagination.next-page', 'Next page')}
        onclick={() => dispatch('lastPageClick', {})}
        aria-hidden={current === totalPage}>
        <i class="fa-solid fa-caret-right"></i>
      </button>
    </li>
  </ul>
</nav>
