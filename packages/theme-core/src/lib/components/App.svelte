
<slot />

<script>
  import { browser } from "$app/environment";

  if (browser) {
    import("$pano/lib/init.libs");
  }
</script>
