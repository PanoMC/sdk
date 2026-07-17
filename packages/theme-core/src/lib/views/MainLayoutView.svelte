<!--
  @view MainLayoutView
  Controller: $pano/lib/layouts/MainLayout.svelte
  Props:
    data           object — root layout load data (hookProps, View, …); unused by the default markup
    themeSettings  object — "themeSettings" context: colors, gaps, footer/breadcrumb toggles, custom CSS
    session        store  — "session" context store; $session.siteInfo feeds the head meta tags
  Slot: the routed page content (rendered inside <Main>).
  Override from a theme:
    theme.config.js → views: { MainLayoutView: () => import("./src/views/MainLayoutView.svelte") }
-->
<svelte:head>
  <meta content={$session.siteInfo.keywords.join(", ")} name="keywords" />
  <meta content={$session.siteInfo.websiteDescription} name="description" />

  <meta content={themeSettings.themeColor || "dark"} name="x-theme" />

  {@html `<style>;</style>`.replace(";", styles)}
</svelte:head>

<Hook name="theme:top" />

<div class="vstack gap-3 min-vh-100">
  <div class="vstack gap-{themeSettings.headerNavBarGap || '3'} flex-grow-0">
    <Header />

    <Navbar />
  </div>

  <Hook name="page:top" />
  {#if breadcrumbEnabled}
    <Breadcrumb />
  {/if}

  <div class="flex-grow-1">
    <Main>
      <slot />
    </Main>
  </div>

  {#if typeof themeSettings.footerEnabled === "undefined" ? true : themeSettings.footerEnabled}
    <Footer />
  {/if}
</div>

<NotificationContainer />

<!-- Modals End -->

<script>
  import Header from "$pano/lib/components/Header.svelte";
  import Navbar from "$pano/lib/components/Navbar.svelte";
  import Main from "$pano/lib/components/Main.svelte";
  import Footer from "$pano/lib/components/Footer.svelte";
  import NotificationContainer from "$pano/lib/components/NotificationContainer.svelte";
  import Hook from "$pano/lib/components/Hook.svelte";
  import Breadcrumb from "$pano/lib/components/Breadcrumb.svelte";

  // Part of the view contract (every view receives the controller's data);
  // the default markup doesn't read it, but theme overrides may.
  // svelte-ignore export_let_unused
  export let data;
  export let themeSettings;
  export let session;

  // Global kill-switch from theme settings. Individual pages opt in to
  // the breadcrumb by returning a `breadcrumbs` array from their load();
  // the Breadcrumb component renders nothing when no items are provided.
  $: breadcrumbEnabled =
    typeof themeSettings.breadcrumbEnabled === "undefined"
      ? true
      : themeSettings.breadcrumbEnabled;

  const styles = `
    body {
      min-height: 100vh;
      ${themeSettings.backgroundColor ? `background-color: ${themeSettings.backgroundColor} !important;` : ""}
      ${themeSettings.files?.backgroundImage ? `background-image: url(/api/theme/file/${themeSettings.files.backgroundImage}) !important;` : ""}
      ${themeSettings.bgImagePosition ? `background-position: ${themeSettings.bgImagePosition} !important;` : ""}
      ${themeSettings.bgImageRepeat ? `background-repeat: ${themeSettings.bgImageRepeat} !important;` : ""}
      ${themeSettings.bgImageSize ? `background-size: ${themeSettings.bgImageSize} !important;` : ""}
    }

    ${themeSettings.customCss || ""}
  `;
</script>
