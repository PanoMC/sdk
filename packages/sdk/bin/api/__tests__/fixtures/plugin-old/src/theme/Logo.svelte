<script>
  export let id;
  const socket = new WebSocket(`ws://${location.host}/api/ws`);
  const ping = () => fetch('/api/panel/demo/things/1', { method: 'PUT' });
</script>

<img src="/api/websiteLogo" alt="logo" />
<a href="/api/demo/things/{id}">things</a>
<p>Don't break on an apostrophe in the markup</p>
