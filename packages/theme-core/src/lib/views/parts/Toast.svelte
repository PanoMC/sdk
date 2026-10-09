<!--
  Default markup of the engine's <Toast> (registry name "Toast", contract 1).

  Props:
    id            number - toast id; the element id must be `appToast{id}` (ToastContainer shows it by that id)
    variant       "success" | "danger" | "warning" | null - the requested tone
    variantClass  string - Bootstrap text class mapped from the variant ("" for a neutral toast)
  Slot: the message.
-->
<div
  id="appToast{id}"
  class="pano-toast animate__animated animate__bounceInUp toast align-items-center shadow-lg text-bg-tertiary opacity-100 {variantClass}"
  role="alert"
  aria-live="assertive"
  aria-atomic="true"
  data-bs-dismiss="toast">
  <div class="toast-body"><slot /></div>
</div>

<script>
  export let id;

  // svelte-ignore export_let_unused
  export let variant = null;

  export let variantClass = "";
</script>
