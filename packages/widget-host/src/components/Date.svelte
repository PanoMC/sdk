<script>
  import { currentLanguage } from '../language.js';
  import { getConfig } from '../config.js';

  let { time, relativeFormat = false, children } = $props();

  const code = $derived($currentLanguage?.code ?? getConfig().locale ?? undefined);
  const date = $derived(new Date(parseInt(time)));
  const exact = $derived(
    new Intl.DateTimeFormat(code, { dateStyle: 'short', timeStyle: 'short' }).format(date),
  );
  const text = $derived.by(() => {
    if (!relativeFormat) {
      return new Intl.DateTimeFormat(code, { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
    }
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const units = [
      ['year', 31536000],
      ['month', 2592000],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60],
    ];
    const formatter = new Intl.RelativeTimeFormat(code, { numeric: 'auto' });
    for (const [unit, size] of units) {
      if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
    }
    return formatter.format(seconds, 'second');
  });
</script>

<span title={exact}>
  {#if children}
    {@render children()}
  {:else}
    {text}
  {/if}
</span>
