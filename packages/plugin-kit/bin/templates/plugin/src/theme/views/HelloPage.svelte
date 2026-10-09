<script module>
  import { api } from '@panomc/sdk/plugin-api';

  // The page of this plugin, at /@@ID@@ on the site. One file is the whole page: the build makes the view,
  // the route and the registration from `view`.
  export const view = { path: '/@@ID@@' };

  // Runs on the server before the page renders; its result becomes the props. The call goes to
  // GetHelloAPI (src/main/kotlin/.../routes/GetHelloAPI.kt), mounted at /api/plugins/@@ID@@/hello.
  export async function load(event) {
    const answer = await api.get({ path: '/hello', request: event });

    return { message: answer?.message ?? '', pageTitle: 'plugins.@@ID@@.hello-title' };
  }
</script>

<script>
  let { message = '' } = $props();
</script>

<div class="card">
  <div class="card-body">
    <h1 class="h3">Hello from @@NAME@@</h1>
    <p class="mb-0">The server says: {message}</p>
  </div>
</div>
