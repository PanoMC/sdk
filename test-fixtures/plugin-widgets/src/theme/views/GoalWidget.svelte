<script module>
  export const view = { widget: true };

  export const load = () => Promise.resolve({ data: { raised: 40, goal: 100 } }).then((data) => ({ data }));
</script>

<script>
  import { _ } from '@panomc/sdk/utils/language';
  import { showToast } from '@panomc/sdk/toasts';
  import { percent } from '../lib/percent.js';

  /** @type {{ data: { raised: number, goal: number }, title?: string }} */
  let { data, title = 'Goal' } = $props();
</script>

<div class="card goals-goal-widget__card">
  <h3 class="card-title goals-goal-widget__title">{title}</h3>
  <div class="goals-goal-widget__bar" style:width="{percent(data.raised, data.goal)}%"></div>
  <button class="btn goals-goal-widget__action" onclick={() => showToast('goals.thanks')}>{$_('goals.support')}</button>
</div>
