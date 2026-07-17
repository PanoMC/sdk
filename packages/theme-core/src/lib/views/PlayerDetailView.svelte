<!--
  @view PlayerDetailView
  Controller: $pano/lib/pages/PlayerDetailPage.svelte
  Props:
    data.registerDate  number — epoch timestamp of when the player registered
  Override from a theme:
    theme.config.js → views: { PlayerDetailView: () => import("./src/views/PlayerDetailView.svelte") }
-->
<!-- Statistics -->
<div class="vstack gap-3">
  <div class="card">
    <div class="card-header">
      {$_("pages.player-profile.title")}
    </div>
    <table class="table">
    <tbody>
      <tr>
        <td>{$_("pages.player-profile.register-date")}</td>
        <td><Date time={data.registerDate} /></td>
      </tr>
    </tbody>
  </table>
  </div>
</div>

<script>
  import { _ } from "svelte-i18n";
  import Date from "$pano/lib/components/Date.svelte";

  export let data;
</script>
