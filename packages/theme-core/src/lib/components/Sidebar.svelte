<!-- Sidebar -->
<aside
  class="col-lg-4 order-first"
  class:order-lg-last={side === "right"}
  class:order-lg-first={side === "left"}>
  <slot />
</aside>

<!-- Sidebar End -->
<script>
  export let side = "right";
</script>
