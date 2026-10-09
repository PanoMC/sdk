<script module>
  import { plugin } from '@panomc/sdk/controllers';

  export const view = { widget: { tag: 'numbers' } };

  export const load = () => plugin('goals').load('stats').then((stats) => ({ stats }));
</script>

<script>
  import { percent } from '../lib/percent.js';

  /** @type {{ stats: { total: number }, limit?: number, compact?: boolean, goalId: number }} */
  let { stats, limit = 5, compact = false, goalId } = $props();
</script>

<ul class:is-compact={compact} data-goal={goalId}>
  <li class="goals-stats-widget__total">{stats.total} / {limit} ({percent(stats.total, limit)}%)</li>
</ul>
