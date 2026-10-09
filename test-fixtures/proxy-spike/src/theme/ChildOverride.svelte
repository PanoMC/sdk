<script>
  import { getPanoContext } from '@panomc/sdk/internal';
  import { readThemeSession } from './session.js';

  let { label } = $props();

  // A theme file reaches plugin views through the registry (doc 01 section 5), here getDefault of the pano context.
  const Badge = getPanoContext().context.views.getDefault('spike:Badge');
  const session = readThemeSession();
</script>

<div class="child-override">
  <em class="label">{label}</em>
  <span class="theme-user">theme-session:{session.user ?? 'guest'}</span>
  <Badge text="inside-override" />
</div>
