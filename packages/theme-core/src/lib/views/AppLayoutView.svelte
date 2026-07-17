<!--
  @view AppLayoutView
  Controller: $pano/lib/layouts/AppLayout.svelte
  Props:
    data       object — root layout load data (session payload, _pageTitleStore, View)
    session    store — writable session store ({ user, csrfToken, siteInfo }) created by init(data)
    pageTitle  store — current page title: null, an i18n key string, or { title, titleValues }
    getTitle   function — (pageTitle, siteName) => formatted document <title> string
  Override from a theme:
    theme.config.js → views: { AppLayoutView: () => import("./src/views/AppLayoutView.svelte") }
-->
<App>
  <slot></slot>
</App>

<ToastContainer />

<script>
  import App from "$pano/lib/components/App.svelte";
  import ToastContainer from "$pano/lib/components/ToastContainer.svelte";

  export let data;
  export let session;
  export let pageTitle;
  export let getTitle;
</script>

<svelte:head>
  <link href="/api/favicon?hash={$session.siteInfo.faviconHash}" rel="icon" />
  <title>{getTitle($pageTitle, $session.siteInfo.websiteName)}</title>
</svelte:head>
