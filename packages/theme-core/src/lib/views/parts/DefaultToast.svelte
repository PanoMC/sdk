<!--
  Default markup of the engine's <DefaultToast> (registry name "DefaultToast", contract 1).

  Props:
    id       number - toast id, passed on to <Toast>
    text     string - the translation key the toast was shown with
    message  string - the translated text with the values already HTML-escaped; safe for {@html}
    variant  "success" | "danger" | "warning" | null - the requested tone
-->
<Toast {id} {variant}>{@html message}</Toast>

<script>
  import Toast from "$pano/lib/components/Toast.svelte";

  export let id;

  // svelte-ignore export_let_unused
  export let text;

  export let message;
  export let variant = null;
</script>
