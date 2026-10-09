<script>
  import { getConfig } from '../config.js';
  import { currentLanguage, translate } from '../language.js';

  let { username, width = 64, height = 64, checkTime, inGame = false, lastActivityTime, banned } = $props();

  const isOnline = $derived(lastActivityTime > Date.now() - 5 * 60 * 1000 || inGame);
  const src = $derived(`${getConfig().apiBase}/api/profile/picture/${encodeURIComponent(username)}`);
  const hint = $derived.by(() => {
    if (banned) return undefined;
    if (isOnline) return translate(`components.player-head.${inGame ? 'in-game' : 'in-website'}`, inGame ? 'In game' : 'On the website');
    const code = $currentLanguage?.code ?? getConfig().locale ?? undefined;
    return new Intl.DateTimeFormat(code, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(parseInt(lastActivityTime)));
  });
</script>

{#if lastActivityTime}
  <img
    {src}
    class="img-thumbnail rounded d-block m-auto"
    {width}
    {height}
    alt={username}
    title={hint}
    class:border={banned || isOnline}
    class:border-3={banned || isOnline}
    class:border-success={!banned && isOnline}
    class:border-danger={banned} />
{:else}
  <img
    {src}
    class="rounded d-block m-auto"
    {width}
    {height}
    alt={username}
    class:border={banned}
    class:border-3={banned}
    class:border-danger={banned} />
{/if}
