<!--
  Controller of the engine's <HomeSidebar>. The markup lives in views/parts/HomeSidebar.svelte; a theme
  may replace it with the "HomeSidebar" entry of theme.config.js views (see skin-contract.json for the
  props). The controller keeps the data, the item list and the copy state.
-->
<svelte:component
  this={getOverride("HomeSidebar") ?? HomeSidebarView}
  {side}
  {items}
  {data}
  {themeSettings}
  {avatarVersion}
  {serverOnline}
  {isCommandTextCopied}
  {onCopyCommandTextClick}
  {playCardIpText}
  {playCardIpLength}
  {playCardBgImage}
  {playCardOpacity}
  {playCardBgStyle}
  {playCardBorderColor}
  {playCardHeaderClass}
  {playCardIpColor}
  {playCardBtnColor}
  {showPlayCardStatusBadge}
  {showPlayCardPlayerCount}
  {showPlayCardVersionInfo} />

<script context="module">
  import ApiUtil from "$pano/lib/api.util.js";
  import { writable } from "svelte/store";
  import { panoApi } from "$pano/lib/PluginAPI";
  import { executeSidebarLoad } from "$pano/lib/PluginAPI";

  const data = writable({});

  export const load = async (event) => {
    /* Register Defaults */
    panoApi.ui.sidebar.register({
      sidebarId: "home",
      id: "play-button",
      component: "local:play-button",
      priority: 100,
    });

    /* Server Info is merged into play-button */

    panoApi.ui.sidebar.register({
      sidebarId: "home",
      id: "last-registrants",
      component: "local:last-registrants",
      priority: 80,
    });

    // Execute sidebar load and resolve components for SSR
    await executeSidebarLoad("home", event);

    data.set(
      await ApiUtil.get({
        path: "/sidebars/home",
        request: event,
      }),
    );
  };
</script>

<script>
  import { getContext } from "svelte";
  import copy from "copy-to-clipboard";
  import { getOverride } from "$pano/registry/index.js";
  import HomeSidebarView from "$pano/lib/views/parts/HomeSidebar.svelte";
  import { avatarVersion } from "$pano/lib/Store";

  export let side;

  const themeSettings = getContext("themeSettings");

  /* Play Button Logic */
  let copyClickIDForCommandText = 0;
  let isCommandTextCopied = false;

  function onCopyCommandTextClick() {
    copyClickIDForCommandText++;
    const id = copyClickIDForCommandText;
    copy(playCardIpText);
    isCommandTextCopied = true;
    setTimeout(function () {
      if (copyClickIDForCommandText === id) {
        isCommandTextCopied = false;
      }
    }, 1000);
  }

  /* Server Info Logic */
  $: serverOnline = $data.mainServer && $data.mainServer.status === "ONLINE";

  /* Register Defaults */
  // Moved to load function

  const items = panoApi.ui.sidebar.get("home");

  /* Background Image Logic (Synced with Header.svelte) */
  const defaultHeaderBg =
    typeof themeSettings.defaultHeaderBg === "undefined"
      ? true
      : themeSettings.defaultHeaderBg;

  $: headerBgImage = defaultHeaderBg
    ? "/assets/img/default-header-bg.png"
    : themeSettings.files?.headerBackgroundImage
      ? "/api/v1/theme/file/" + themeSettings.files?.headerBackgroundImage
      : "";

  $: defaultPlayCardBg =
    typeof themeSettings.defaultPlayCardBg === "undefined"
      ? true
      : themeSettings.defaultPlayCardBg;

  $: playCardBgImage = themeSettings.files?.playCardBackgroundImage
    ? "/api/v1/theme/file/" + themeSettings.files?.playCardBackgroundImage
    : defaultPlayCardBg
      ? headerBgImage
      : "";

  $: playCardOpacity = themeSettings.playCardBgOpacity ?? 0.5;
  $: playCardBgEffect = themeSettings.playCardBgEffect || "solid";

  $: playCardBgStyle =
    playCardBgEffect === "gradient"
      ? `background: linear-gradient(180deg, transparent 0%, var(--bs-body-bg) 100%);`
      : `background-color: color-mix(in srgb, var(--bs-body-bg) 70%, transparent);`;

  $: playCardHeaderClass =
    !themeSettings.playCardBorderColor ||
    themeSettings.playCardBorderColor === "default"
      ? "text-bg-secondary"
      : themeSettings.playCardBorderColor.replace("border-", "text-bg-");

  $: playCardIpColor =
    !themeSettings.playCardIpColor ||
    themeSettings.playCardIpColor === "default"
      ? "link-secondary"
      : "link-" + themeSettings.playCardIpColor;

  $: playCardBtnColor =
    !themeSettings.playCardIpColor ||
    themeSettings.playCardIpColor === "default"
      ? !themeSettings.playCardBorderColor ||
        themeSettings.playCardBorderColor === "default"
        ? "secondary"
        : themeSettings.playCardBorderColor.replace("border-", "")
      : themeSettings.playCardIpColor;

  $: playCardBorderColor =
    !themeSettings.playCardBorderColor ||
    themeSettings.playCardBorderColor === "default"
      ? "border-secondary"
      : themeSettings.playCardBorderColor;

  $: playCardIpText = themeSettings.playCardIpText || $data.ipAddress;
  // Feeds the no-JS estimate in the stylesheet; 1 keeps that division safe
  // before the address has loaded.
  $: playCardIpLength = String(playCardIpText || "").length || 1;

  $: showPlayCardStatusBadge = themeSettings.playCardStatusBadge ?? true;
  $: showPlayCardPlayerCount = themeSettings.playCardPlayerCount ?? true;
  $: showPlayCardVersionInfo = themeSettings.playCardVersionInfo ?? true;
</script>
