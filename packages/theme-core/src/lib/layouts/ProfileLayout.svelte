<!-- Profile Layout -->
<slot />

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/layout-logics/ProfileLayoutLogics";

  export async function load(event) {
    return await processLoad(event);
  }
</script>
