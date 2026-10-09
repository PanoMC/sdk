<nav class="pano-pagination">
  <ul class="pano-pagination__pager pagination pagination-sm mb-0 justify-content-start flex-wrap">
    <li class="page-item" class:disabled={parseInt(page) === 1}>
      <button
        type="button"
        class="page-link"
        title={$_("components.pagination.previous-page")}
        onclick={onFirstPageClick}
        aria-hidden={parseInt(page) === 1}>
        <i class="fa-solid fa-caret-left"></i>
      </button>
    </li>

    {#each pages as index}
      <li
        class="page-item"
        class:active={parseInt(page) === index}
        aria-current={parseInt(page) === index ? "page" : ""}>
          <button
            type="button"
            class="page-link"
            onclick={() => onPageLinkClick(index)}
            aria-hidden={parseInt(page) === index}>
            {index}
          </button>
      </li>
    {/each}

    <li class="page-item" class:disabled={parseInt(page) === totalPages}>
      <button
        type="button"
        class="page-link"
        title={$_("components.pagination.next-page")}
        onclick={onLastPageClick}
        aria-hidden={parseInt(page) === totalPages}>
        <i class="fa-solid fa-caret-right"></i>
      </button>
    </li>
  </ul>
</nav>

<script>
  import { createEventDispatcher } from "svelte";
  import { _ } from "svelte-i18n";

  const dispatch = createEventDispatcher();

  let { page = 1, totalPages = 1 } = $props();

  const pages = $derived(Array.from({ length: totalPages }, (_, i) => i + 1));

  function onFirstPageClick() {
    dispatch("firstPageClick", {});
  }

  function onLastPageClick() {
    dispatch("lastPageClick", {});
  }

  function onPageLinkClick(index) {
    dispatch("pageLinkClick", {
      page: index,
    });
  }
</script>
