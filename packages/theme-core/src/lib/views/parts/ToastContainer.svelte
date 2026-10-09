<!--
  Default markup of the engine's <ToastContainer> (registry name "ToastContainer", contract 1).

  Props:
    toasts  store - the toasts on screen: [{ id, component, params }]; render each with
            <svelte:component this={toast.component} id={toast.id} {...toast.params} />
            (`component` is <DefaultToast> unless the caller passed its own)
-->
<div class="pano-toast-container toast-container position-fixed bottom-0 start-50 translate-middle-x mb-3">
  {#each $toasts as toast, index (toast)}
    <svelte:component this={toast.component} id={toast.id} {...toast.params} />
  {/each}
</div>

<script>
  export let toasts;
</script>
