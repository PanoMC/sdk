<script>
  export let id;
  const socket = new WebSocket(`ws://${location.host}/api/v1/ws`);
  const ping = () => fetch('/api/plugins/pano-plugin-demo/panel/things/1', { method: 'PUT' });
</script>

<img src="/api/v1/website-logo" alt="logo" />
<a href="/api/plugins/pano-plugin-demo/things/{id}">things</a>
<p>Don't break on an apostrophe in the markup</p>
