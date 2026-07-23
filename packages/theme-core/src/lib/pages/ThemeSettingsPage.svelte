<svelte:component
  this={data.View}
  {data}
  {themeSettings}
  {session}
  {activeTab}
  {saving}
  {resetting}
  {resettingAll}
  {backgroundImageFiles}
  {headerBackgroundImageFiles}
  {playCardBackgroundImageFiles}
  {currentThemeDefault}
  {defaultHeaderBg}
  {orderedNavLinks}
  {orderedFooterLinks}
  {draggingItemIndex}
  {dragOverItemIndex}
  {tabChanged}
  {tabResetVisible}
  {allResetVisible}
  {onThemeColorChange}
  {onBackgroundImageChange}
  {onRemoveBackgroundImageClick}
  {onHeaderBackgroundImageChange}
  {onRemoveHeaderBackgroundImageClick}
  {onPlayCardBackgroundImageChange}
  {onRemovePlayCardBackgroundImageClick}
  {onDragStart}
  {onDragOver}
  {onDragEnd}
  {onDrop}
  {toggleLink}
  {toggleFooterLink}
  {save}
  {resetTab}
  {resetAll} />

<script context="module">
  import { writable } from "svelte/store";
  import { resolveView } from "$pano/registry/index.js";

  /**
   * @type {import("@sveltejs/kit").Load}
   */
  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "ThemeSettingsView",
      () => import("../views/ThemeSettingsView.svelte"),
    );

    const { parent } = event;

    const { themeSettings } = await parent();
    return { themeSettings, View: await viewPromise };
  }
</script>

<script>
  import { _ } from "svelte-i18n";
  import {
    showToast,
    showConfirm
  } from "$pano/lib/ui-logics/layout-logics/ThemeSettingsLayoutLogics";
  import { getContext } from "svelte";
  import { saveThemeSettings } from "$pano/lib/services/theme-setting";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";
  import { orderLinksBySavedOrder } from "$pano/lib/orderNavLinks.util.js";
  import { getSettingsSchemaExtension } from "$pano/registry/index.js";

  export let data;

  const themeSettings = writable(data.themeSettings);
  const originalThemeSettings = writable(JSON.parse(JSON.stringify(data.themeSettings)));
  const session = getContext("session");

  // Theme-declared settings-schema extension (theme.config.js → settingsSchema).
  // Additive only: it appends keys/tabs to the base tab map below so a fork's
  // ThemeSettingsView can edit extra keys/tabs and still get save / reset /
  // dirty-check coverage. Populated on both server and client before load runs.
  const settingsSchemaExtension = getSettingsSchemaExtension();

  const saving = writable(false);
  const resetting = writable(false);
  const resettingAll = writable(false);
  const activeTab = writable(settingsSchemaExtension?.defaultTab ?? "general");
  const backgroundImageFiles = writable(null);
  const headerBackgroundImageFiles = writable(null);
  const playCardBackgroundImageFiles = writable(null);

  const themeDefaults = {
    dark: { navbar: "#044389", header: "#ffffff" },
    light: { navbar: "#ffffff", header: "#ffffff" },
    copper: { navbar: "#9c622b", header: "#b87333" },
    emerald: { navbar: "#0d8a61", header: "#10b981" },
    midnight: { navbar: "#6d44c5", header: "#8b5cf6" },
    crimson: { navbar: "#bf3636", header: "#ef4444" }
  };

  const currentThemeDefault = writable(themeDefaults.dark);
  $: $currentThemeDefault = themeDefaults[$themeSettings.themeColor || "dark"] || themeDefaults.dark;


  function onThemeColorChange(e) {
    const value = e.target.value;
    $themeSettings.themeColor = value;

    if (value === "copper") {
      $themeSettings.navbarBgColor = "#9c622b";
      $themeSettings.headerBgColor = "#b87333";
    } else if (value === "emerald") {
      $themeSettings.navbarBgColor = "#0d8a61";
      $themeSettings.headerBgColor = "#10b981";
    } else if (value === "midnight") {
      $themeSettings.navbarBgColor = "#6d44c5";
      $themeSettings.headerBgColor = "#8b5cf6";
    } else if (value === "crimson") {
      $themeSettings.navbarBgColor = "#bf3636";
      $themeSettings.headerBgColor = "#ef4444";
    } else if (value === "dark") {
      $themeSettings.navbarBgColor = "#044389";
      $themeSettings.headerBgColor = "#ffffff";
    } else if (value === "light") {
      $themeSettings.navbarBgColor = "#ffffff";
      $themeSettings.headerBgColor = "#ffffff";
    }
  }

  const navPluginLinks = panoApiClient.ui.nav.site.getNavLinks();

  const orderedNavLinks = writable([]);
  const orderedFooterLinks = writable([]);

  const nativeLinks = [
    { id: "home", text: "pages.theme-settings.navbar.home", href: "/" },
    { id: "support", text: "pages.theme-settings.navbar.support", href: "/support" },
    { id: "rules", text: "pages.theme-settings.navbar.rules", href: "/rules" }
  ];

  /* Navbar Link Management */
  $: {
    const pluginLinks = $navPluginLinks.map((l) => ({
      ...l,
      id: l.href,
      isPlugin: true
    }));

    const allLinksSource = [...nativeLinks, ...pluginLinks];

    $orderedNavLinks = orderLinksBySavedOrder(
      allLinksSource,
      $themeSettings.navLinksOrder
    );
    $orderedFooterLinks = orderLinksBySavedOrder(
      allLinksSource,
      $themeSettings.footerLinksOrder
    );
  }

  const draggingItemIndex = writable(null);
  const dragOverItemIndex = writable(null);

  function onDragStart(event, index) {
    $draggingItemIndex = index;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", index);
  }

  function onDragOver(event, index) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    $dragOverItemIndex = index;
  }

  function onDragEnd() {
    $draggingItemIndex = null;
    $dragOverItemIndex = null;
  }

  function onDrop(event, index, target = "nav") {
    event.preventDefault();
    const fromIndex = $draggingItemIndex;
    const toIndex = index;

    $draggingItemIndex = null;
    $dragOverItemIndex = null;

    if (fromIndex === null || fromIndex === toIndex) return;

    if (target === "nav") {
      const newOrder = [...$orderedNavLinks];
      const [movedItem] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, movedItem);

      $orderedNavLinks = newOrder;
      $themeSettings.navLinksOrder = newOrder.map((l) => l.id);
    } else if (target === "footer") {
      const newOrder = [...$orderedFooterLinks];
      const [movedItem] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, movedItem);

      $orderedFooterLinks = newOrder;
      $themeSettings.footerLinksOrder = newOrder.map((l) => l.id);
    }
  }

  function toggleLink(id, checked) {
    if (!$themeSettings.navLinksEnableStatus)
      $themeSettings.navLinksEnableStatus = {};
    $themeSettings.navLinksEnableStatus[id] = checked;
    $themeSettings = $themeSettings;
  }

  function toggleFooterLink(id, checked) {
    if (!$themeSettings.footerLinksEnableStatus)
      $themeSettings.footerLinksEnableStatus = {};
    $themeSettings.footerLinksEnableStatus[id] = checked;
    $themeSettings = $themeSettings;
  }

  const baseTabKeys = {
    general: [
      "themeColor",
      "backgroundColor",
      "bgImagePosition",
      "bgImageRepeat",
      "bgImageSize",
      "backgroundImage"
    ],
    logo: [
      "logoVisibility",
      "logoPosition",
      "logoHeight",
      "logoWidth",
      "logoAnimation"
    ],
    header: [
      "defaultHeaderBg",
      "headerBgColor",
      "headerHeight",
      "headerWidthOption",
      "headerNavBarGap",
      "headerBgImagePosition",
      "headerBgImageRepeat",
      "headerBgImageSize",
      "headerBackgroundImage"
    ],
    navbar: [
      "navbarWidthOption",
      "navbarBgColor",
      "navRoundLevel",
      "navLinksEnabled",
      "navLinksEnableStatus",
      "navLinksOrder"
    ],
    sidebar: ["sidebarEnabled", "sidebarPosition", "sidebarCarts"],
    "play-card": [
      "playCardStyle",
      "defaultPlayCardBg",
      "playCardBgOpacity",
      "playCardBgEffect",
      "playCardBackgroundImage",
      "playCardIpText",
      "playCardStatusBadge",
      "playCardPlayerCount",
      "playCardVersionInfo",
      "playCardIpColor",
      "playCardBorderColor"
    ],
    "post-card": [
      "postsEnabled",
      "postCoverImageEnabled",
      "postReadMoreButtonEnabled",
      "postAuthorImageEnabled",
      "postViewCountEnabled",
      "postPreviousPageEnabled",
      "postNextPageEnabled"
    ],
    footer: [
      "footerEnabled",
      "footerLogoEnabled",
      "footerTitleEnabled",
      "footerTitle",
      "footerContentEnabled",
      "footerContent",
      "footerLinksEnabled",
      "footerPluginLinksEnabled",
      "footerLinksEnableStatus",
      "footerLinksOrder"
    ],
    advanced: ["customCss"]
  };

  // Effective tab → settings-key map: the base map with the theme's
  // settingsSchema extension merged in. ADDITIVE ONLY — extension keys are
  // appended to their tab (deduped), tabs absent from the base are appended
  // AFTER the base tabs, and nothing the base defines is ever removed. Every
  // consumer below (save / reset / dirty-check) iterates this merged map.
  const tabKeys = (() => {
    const merged = {};
    for (const tab in baseTabKeys) merged[tab] = [...baseTabKeys[tab]];

    const extTabs = settingsSchemaExtension?.tabs;
    if (extTabs) {
      for (const tab in extTabs) {
        if (!merged[tab]) merged[tab] = [];
        for (const key of extTabs[tab]) {
          if (!merged[tab].includes(key)) merged[tab].push(key);
        }
      }
    }

    return merged;
  })();

  const checkTabChanged = (tab, current, original) => {
    return tabKeys[tab]?.some((key) => {
      if (
        key === "backgroundImage" ||
        key === "headerBackgroundImage" ||
        key === "playCardBackgroundImage"
      ) {
        const uploadExists = !!current.uploads?.[key];
        const fileDeleted = original.files?.[key] && !current.files?.[key];
        return uploadExists || fileDeleted;
      }
      return JSON.stringify(current[key]) !== JSON.stringify(original[key]);
    });
  };

  const checkTabHasData = (tab, original) => {
    return tabKeys[tab]?.some((key) => {
      if (
        key === "backgroundImage" ||
        key === "headerBackgroundImage" ||
        key === "playCardBackgroundImage"
      ) {
        return !!original.files?.[key];
      }
      return typeof original[key] !== "undefined" && original[key] !== null;
    });
  };

  const tabChanged = writable(false);
  const tabResetVisible = writable(false);
  const allResetVisible = writable(false);
  const defaultHeaderBg = writable(true);

  $: $tabChanged = checkTabChanged(
    $activeTab,
    $themeSettings,
    $originalThemeSettings
  );
  $: tabHasSavedData = checkTabHasData($activeTab, $originalThemeSettings);

  $: anyUnsavedChanges = Object.keys(tabKeys).some((tab) =>
    checkTabChanged(tab, $themeSettings, $originalThemeSettings)
  );
  $: anySettingsExist = Object.keys(tabKeys).some((tab) =>
    checkTabHasData(tab, $originalThemeSettings)
  );

  $: $tabResetVisible = $tabChanged || tabHasSavedData;
  $: $allResetVisible = anyUnsavedChanges || anySettingsExist;

  $: $defaultHeaderBg =
    typeof $themeSettings.defaultHeaderBg === "undefined"
      ? true
      : $themeSettings.defaultHeaderBg;

  function onBackgroundImageChange(event) {
    // const reader = new FileReader();
    const image = event.target.files[0];

    $themeSettings.uploads = {
      ...($themeSettings.uploads || {}),
      backgroundImage: image,
    };

    // reader.readAsDataURL(image);
    //
    // reader.onload = (e) => {
    //   favicon = e.target.result;
    // };
    //
    // selectedFaviconFiles = faviconFiles;
  }

  function onRemoveBackgroundImageClick() {
    delete $themeSettings.files.backgroundImage;

    $themeSettings = $themeSettings;
  }

  function onRemoveHeaderBackgroundImageClick() {
    delete $themeSettings.files.headerBackgroundImage;

    $themeSettings = $themeSettings;
  }

  function onHeaderBackgroundImageChange(event) {
    // const reader = new FileReader();
    const image = event.target.files[0];

    $themeSettings.uploads = {
      ...($themeSettings.uploads || {}),
      headerBackgroundImage: image,
    };

    // reader.readAsDataURL(image);
    //
    // reader.onload = (e) => {
    //   favicon = e.target.result;
    // };
    //
    // selectedFaviconFiles = faviconFiles;
  }

  function onPlayCardBackgroundImageChange(event) {
    const image = event.target.files[0];

    $themeSettings.uploads = {
      ...($themeSettings.uploads || {}),
      playCardBackgroundImage: image,
    };
  }

  function onRemovePlayCardBackgroundImageClick() {
    if (!$themeSettings.files) $themeSettings.files = {};
    delete $themeSettings.files.playCardBackgroundImage;

    $themeSettings = $themeSettings;
  }

  async function save() {
    $saving = true;

    // Deep copy so "files" arrays and nested objects are never shared with the store, and
    // backend + merge get a full snapshot. Tab-scoped changes are applied on top of this.
    const settingsToSave = structuredClone($originalThemeSettings);
    if (!settingsToSave.files) settingsToSave.files = {};
    settingsToSave.uploads = { ...($themeSettings.uploads || {}) };

    tabKeys[$activeTab].forEach((key) => {
      if (
        key === "backgroundImage" ||
        key === "headerBackgroundImage" ||
        key === "playCardBackgroundImage"
      ) {
        if (!$themeSettings.files?.[key]) {
          // Empty list: backend treats as explicit clear (and does not re-merge that key)
          settingsToSave.files[key] = [];
        }
        // Uploads already handled above
      } else {
        settingsToSave[key] = $themeSettings[key];
      }
    });

    // Only send the relevant uploads
    if (settingsToSave.uploads) {
      Object.keys(settingsToSave.uploads).forEach((key) => {
        if (!tabKeys[$activeTab].includes(key)) {
          delete settingsToSave.uploads[key];
        }
      });
    }

    const response = await saveThemeSettings(settingsToSave);
    const newSettings = JSON.parse(await response.text());
    delete newSettings["result"];

    $backgroundImageFiles = null;
    $headerBackgroundImageFiles = null;

    $themeSettings = newSettings;
    originalThemeSettings.set(structuredClone($themeSettings));

    showToast(
      $_("messages.settings-save-success") || "Ayarlar başarıyla kaydedildi!"
    );
    $saving = false;
  }

  async function resetTab() {
    showConfirm("components.modals.confirm-reset-tab.title", async () => {
      $resetting = true;

      const settingsToSave = structuredClone($originalThemeSettings);
      if (!settingsToSave.files) settingsToSave.files = {};

      tabKeys[$activeTab].forEach((key) => {
        if (
          key === "backgroundImage" ||
          key === "headerBackgroundImage" ||
          key === "playCardBackgroundImage"
        ) {
          settingsToSave.files[key] = [];
          if ($themeSettings.uploads) delete $themeSettings.uploads[key];
        } else {
          delete settingsToSave[key];
        }
      });

      const response = await saveThemeSettings(settingsToSave);
      const newSettings = JSON.parse(await response.text());
      delete newSettings["result"];

      $backgroundImageFiles = null;
      $headerBackgroundImageFiles = null;
      $playCardBackgroundImageFiles = null;

      $themeSettings = newSettings;
      originalThemeSettings.set(structuredClone($themeSettings));

      showToast(
        $_("messages.settings-reset-tab-success") ||
        "Sekme ayarları sıfırlandı!"
      );
      $resetting = false;
    });
  }

  async function resetAll() {
    showConfirm("components.modals.confirm-reset-all.title", async () => {
      $resettingAll = true;

      try {
        const response = await saveThemeSettings({});
        const newSettings = JSON.parse(await response.text());
        delete newSettings["result"];

        $backgroundImageFiles = null;
        $headerBackgroundImageFiles = null;

        $themeSettings = newSettings;
        originalThemeSettings.set(structuredClone($themeSettings));

        showToast($_("messages.settings-reset-all-success"));
      } catch (error) {
        console.error("Failed to reset all settings:", error);
        showToast($_("messages.settings-reset-all-error"));
      } finally {
        $resettingAll = false;
      }
    });
  }
</script>
