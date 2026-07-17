<span class="badge rounded-pill text-bg-secondary">
  {#if permissionGroupName}
    {permissionGroupName.capitalize()}
  {:else}
    {$_("components.player-permission-badge.player")}
  {/if}
</span>

<script context="module">
  String.prototype.capitalize = function () {
    return this.charAt(0).toUpperCase() + this.slice(1);
  };
</script>

<script>
  import { _ } from "svelte-i18n";

  export let permissionGroupName;
</script>
