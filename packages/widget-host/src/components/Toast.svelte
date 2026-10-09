<script>
  // 'success' | 'danger' | null, mapped so a caller cannot inject an arbitrary utility class.
  let { id, variant = null, children } = $props();

  const VARIANT_CLASSES = { success: 'text-success', danger: 'text-danger' };
  const variantClass = $derived(VARIANT_CLASSES[variant] ?? '');
</script>

<div
  id="appToast{id}"
  class="toast show align-items-center shadow-lg text-bg-tertiary opacity-100 {variantClass}"
  role="alert"
  aria-live="assertive"
  aria-atomic="true">
  <div class="toast-body">{@render children?.()}</div>
</div>
