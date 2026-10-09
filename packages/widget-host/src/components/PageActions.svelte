<script>
  // `left` / `middle` / `right` are snippets (the named slots of the theme component).
  let { leftClasses = undefined, middleClasses = undefined, rightClasses = undefined, left, middle, right } = $props();
</script>

<div class="row d-flex align-items-center gy-3 justify-content-lg-between justify-content-center">
  {#if leftClasses !== null && (left || leftClasses !== undefined)}
    <div class="col-lg-auto col-12 d-flex justify-content-lg-start overflow-x-auto {leftClasses || ''}">
      {@render left?.()}
    </div>
  {/if}
  {#if middleClasses !== null && (middle || middleClasses !== undefined)}
    <div class="col-lg-auto col-12 order-lg-2 order-last d-flex justify-content-center overflow-x-auto {middleClasses || ''}">
      {@render middle?.()}
    </div>
  {/if}
  {#if rightClasses !== null && (right || rightClasses !== undefined)}
    <div class="col-lg-auto col-12 order-3 d-flex justify-content-lg-end overflow-x-auto {rightClasses || ''}">
      {@render right?.()}
    </div>
  {/if}
</div>
