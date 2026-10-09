<!--
  Default markup of the engine's <Sidebar> (registry name "Sidebar", contract 1).

  Props:
    side  "left" | "right" - which side of the content the column sits on
  Slot: the sidebar widgets.
-->
<!-- Sidebar -->
<aside
  class="pano-sidebar col-lg-4 order-first"
  class:order-lg-last={side === "right"}
  class:order-lg-first={side === "left"}>
  <slot />
</aside>

<!-- Sidebar End -->
<script>
  export let side = "right";
</script>
