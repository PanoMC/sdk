<!--
  Controller of the engine's <ToastContainer>. The markup lives in views/parts/ToastContainer.svelte; a theme may
  replace it with the "ToastContainer" entry of theme.config.js views (see skin-contract.json for the props).
  The module API (show, showSuccess, showError, limitTitle) stays here.
-->
<svelte:component this={getOverride("ToastContainer") ?? ToastContainerView} {toasts} />

<script context="module">
  import { tick } from "svelte";
  import { writable } from "svelte/store";

  import DefaultToast from "$pano/lib/components/DefaultToast.svelte";

  const toasts = writable([]);
  let id = 0;

  Array.prototype.insert = function (index, item) {
    this.splice(index, 0, item);

    return this;
  };

  Array.prototype.remove = function (index) {
    this.splice(index, 1);

    return this;
  };

  function delay(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
  }

  // `options.variant` ('success' | 'danger' | 'warning') colours the toast text; it is the
  // 4th argument of showToast(text, params, toastComponent, { variant }) in @panomc/sdk/toasts.
  // Prefer the showSuccess/showError wrappers below at call sites — they read as the outcome
  // they report. Plain `show` stays neutral for toasts that are neither.
  export async function show(text, params = {}, toastComponent = DefaultToast, options = {}) {
    if (text) {
      params.text = text;
    }

    if (toastComponent === DefaultToast) {
      params = { text, values: params, variant: options?.variant ?? null };
    }

    const toast = { component: toastComponent, params };

    id = id + 1;

    toast.id = id;

    toasts.update((toasts) => {
      toasts.push(toast);

      return toasts;
    });

    await tick();

    const toastElement = document.getElementById('appToast' + id);

    if (toastElement) {
      const toast = new window.bootstrap.Toast(toastElement);

      toast.show();

      toastElement.addEventListener('hidden.bs.toast', () => {
        toasts.update((toasts) => {
          const foundToast = toasts.find((toast) => toast.id === id);

          toasts.remove(toasts.indexOf(foundToast));

          return toasts;
        });
      });
    }
  }

  // No toastComponent parameter on purpose: `variant` is only threaded into
  // DefaultToast's props, so a custom component would silently drop it. Reach for
  // `show` directly when you need one.
  export function showSuccess(text, params = {}) {
    return show(text, params, DefaultToast, { variant: 'success' });
  }

  export function showError(text, params = {}) {
    return show(text, params, DefaultToast, { variant: 'danger' });
  }

  export function limitTitle(text) {
    const limit = 32;

    if (text.length > limit) {
      text = text.substring(0, limit) + '...';
    }

    return text;
  }
</script>

<script>
  import { getOverride } from "$pano/registry/index.js";
  import ToastContainerView from "$pano/lib/views/parts/ToastContainer.svelte";
</script>
