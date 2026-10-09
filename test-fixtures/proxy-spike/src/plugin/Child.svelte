<script>
  import Badge from './Badge.proxy.js';
  import { readSession } from './session.js';

  let { label } = $props();

  const session = readSession();
</script>

<div class="child-default">
  <span class="label">{label}</span>
  <span class="child-user">session:{session.user ?? 'guest'}</span>
  <Badge text="inside-default-child" />
</div>
