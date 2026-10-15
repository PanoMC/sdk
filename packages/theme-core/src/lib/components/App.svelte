
<slot />

<script>
  import { browser } from "$app/env";

  if (browser) {
    import("$pano/lib/init.libs");
  }
</script>
