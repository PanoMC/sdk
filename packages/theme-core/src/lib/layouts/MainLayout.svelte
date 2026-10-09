<svelte:component this={View} data={viewData} {themeSettings} {session} {chrome}>
  <slot />
</svelte:component>

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/layout-logics/MainLayoutLogics";
  import { loadView } from "$pano/registry/index.js";

  /**
   * @type {import("@sveltejs/kit").LayoutLoad}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const data = await processLoad(event);

    // Chrome components resolve through the registry too: forks restyle the
    // navbar/header/footer far more often than whole layouts, so overriding
    // just `Navbar` must not require ejecting MainLayoutView. loadView also
    // returns the `block:` data of every <PluginBlock> placed in each of them.
    const [
      { View, ...layoutBlocks },
      { View: NavbarC, ...navbarBlocks },
      { View: HeaderC, ...headerBlocks },
      { View: FooterC, ...footerBlocks },
    ] = await Promise.all([
      loadView(event, "MainLayoutView", () => import("../views/MainLayoutView.svelte")),
      loadView(event, "Navbar", () => import("../components/Navbar.svelte")),
      loadView(event, "Header", () => import("../components/Header.svelte")),
      loadView(event, "Footer", () => import("../components/Footer.svelte")),
    ]);

    // `mainLayoutView` alias: this load's result is merged into the ROOT
    // layout data (routes/root-layout-load.js), and RootLayout mounts this
    // layout WITHOUT a data prop, so the instance script falls back to
    // $page.data — where the generic `View` key is clobbered by every split
    // page's own view. The unique key survives that merge.
    return {
      ...data,
      ...layoutBlocks,
      ...navbarBlocks,
      ...headerBlocks,
      ...footerBlocks,
      mainLayoutView: View,
      mainLayoutChrome: { Navbar: NavbarC, Header: HeaderC, Footer: FooterC },
    };
  }
</script>

<script>
  import { getContext } from "svelte";
  import { page } from "$app/stores";

  // RootLayout renders <MainLayout><slot /></MainLayout> with no data prop;
  // fall back to the root-merged $page.data (see the alias note in load above).
  export let data = undefined;

  const themeSettings = getContext("themeSettings");
  const session = getContext("session");

  $: View = data?.mainLayoutView ?? $page.data.mainLayoutView;
  $: viewData = data ?? $page.data;
  $: chrome = viewData?.mainLayoutChrome ?? $page.data.mainLayoutChrome;
</script>
