{#if lastActivityTime}
  <img
    src="/api/profile/picture/{username}?{$avatarVersion}"
    class="img-thumbnail rounded d-block m-auto"
    width="{width}"
    height="{height}"
    alt="{username}"
    class:border="{banned ||isOnline}"
    class:border-3="{banned || isOnline}"
    class:border-success="{!banned && isOnline}"
    class:border-danger="{banned}"
    use:tooltip="{!banned && [
      isOnline
        ? $_('components.player-head.' + (inGame ? 'in-game' : 'in-website'))
        : getOfflineRelativeDateText(checkTime),
      { placement: 'right' },
    ]}" />
{:else}
  <img
    src="/api/profile/picture/{username}?{$avatarVersion}"
    class="rounded d-block m-auto"
    width="{width}"
    height="{height}"
    alt="{username}"
    class:border="{banned}"
    class:border-3="{banned}"
    class:border-danger="{banned}" />
{/if}

<script>
  import tooltip from "$pano/lib/tooltip.util";
  import { formatRelative } from "date-fns";
  import * as locales from "date-fns/locale";
  import { currentLanguage } from "$pano/lib/language.util.js";

  import { _ } from "svelte-i18n";
  import { avatarVersion } from "$pano/lib/Store";

  export let username;
  export let width = 64;
  export let height = 64;
  export let checkTime;
  export let inGame = false;
  export let lastActivityTime;
  export let banned;

  $: isOnline = lastActivityTime > Date.now() - 5 * 60 * 1000 || inGame;

  function getOfflineRelativeDateText(checkTime) {
    return formatRelative(new Date(parseInt(lastActivityTime)), new Date(), {
      locale: locales[$currentLanguage.dateFnsCode]
    }).capitalize();
  }

  String.prototype.capitalize = function () {
    return this.charAt(0).toUpperCase() + this.slice(1);
  };
</script>
