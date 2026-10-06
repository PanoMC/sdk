<div class="card">
  <div
    class="card-body"
    data-fixture="player-tab"
    data-fixture-username={data.username}
    data-fixture-url={data.url}
    data-fixture-status={data.status}
    data-fixture-player-id={data.playerId}
    data-fixture-auth={typeof hasPermission}>
    {$_(`plugins.tc9-fixture.nav-fixture`)}: {data.username}
  </div>
</div>

<script module>
  import ApiUtil from '@panomc/sdk/utils/api';

  /** The host passes the route params of the layout to the page load (T13): `event.params.username` must be the player, never `undefined`. */
  export async function load(event) {
    const username = event.params?.username;
    const url = `/api/panel/players/${encodeURIComponent(username)}`;
    const body = await ApiUtil.get({ path: url, request: event });

    return { data: { username, url, status: body?.result ?? body?.error ?? 'none', playerId: body?.player?.id ?? null } };
  }
</script>

<script>
  import { _ } from '@panomc/sdk/utils/language';
  import { hasPermission } from '@panomc/sdk/utils/auth';

  let { data } = $props();
</script>
