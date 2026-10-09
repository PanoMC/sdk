<!--
  @view ThemeSettingsView
  Controller: $pano/lib/pages/ThemeSettingsPage.svelte
  Props:
    data                                   object — page data (themeSettings, View)
    themeSettings                          writable store — live theme settings object being edited
    session                                store — session context (siteInfo: serverIp, websiteName, ...)
    activeTab                              writable store — selected settings tab id ("general", "logo", ...)
    saving                                 writable store — save request in-flight flag
    resetting                              writable store — tab reset in-flight flag
    resettingAll                           writable store — full reset in-flight flag
    backgroundImageFiles                   writable store — FileList of the picked page background image
    headerBackgroundImageFiles             writable store — FileList of the picked header background image
    playCardBackgroundImageFiles           writable store — FileList of the picked play-card background image
    currentThemeDefault                    store — default navbar/header colors for the selected theme color
    defaultHeaderBg                        store — whether the default header background is active
    orderedNavLinks                        writable store — nav links (native + plugin) in saved order
    orderedFooterLinks                     writable store — footer links (native + plugin) in saved order
    draggingItemIndex                      writable store — index of the link row being dragged (or null)
    dragOverItemIndex                      writable store — index of the link row dragged over (or null)
    tabChanged                             store — active tab has unsaved changes
    tabResetVisible                        store — reset-tab button visibility
    allResetVisible                        store — reset-all button visibility
    onThemeColorChange                     function — theme color select handler (also applies default colors)
    onBackgroundImageChange                function — page background image file-input change handler
    onRemoveBackgroundImageClick           function — remove the saved page background image
    onHeaderBackgroundImageChange          function — header background image file-input change handler
    onRemoveHeaderBackgroundImageClick     function — remove the saved header background image
    onPlayCardBackgroundImageChange        function — play-card background image file-input change handler
    onRemovePlayCardBackgroundImageClick   function — remove the saved play-card background image
    onDragStart                            function — dragstart handler for link reordering (event, index)
    onDragOver                             function — dragover handler for link reordering (event, index)
    onDragEnd                              function — dragend handler for link reordering
    onDrop                                 function — drop handler for link reordering (event, index, "nav" | "footer")
    toggleLink                             function — enable/disable a navbar link (id, checked)
    toggleFooterLink                       function — enable/disable a footer link (id, checked)
    save                                   function — save the active tab's settings
    resetTab                               function — reset the active tab's settings (with confirm)
    resetAll                               function — reset all theme settings (with confirm)
  Override from a theme:
    theme.config.js → views: { ThemeSettingsView: () => import("./src/views/ThemeSettingsView.svelte") }
-->
<!-- Theme settings -->
<div class="pano-theme-settings-view card">
  <div class="pano-theme-settings-view__header card-header">
    <ul
      class="nav nav-tabs card-header-tabs"
      id="themeSettingsTabs"
      role="tablist">
      <li class="nav-item" role="presentation">
        <button
          class="pano-theme-settings-view__link nav-link"
          class:active={$activeTab === "general"}
          data-bs-target="#general"
          data-bs-toggle="tab"
          id="general-tab"
          on:click={() => ($activeTab = "general")}
          role="tab"
          type="button">
          {$_("pages.theme-settings.tabs.general")}
        </button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="pano-theme-settings-view__logo nav-link"
          class:active={$activeTab === "logo"}
          data-bs-target="#logo"
          data-bs-toggle="tab"
          id="logo-tab"
          on:click={() => ($activeTab = "logo")}
          role="tab"
          type="button">
          {$_("pages.theme-settings.tabs.logo")}
        </button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="pano-theme-settings-view__cover nav-link"
          class:active={$activeTab === "header"}
          data-bs-target="#header"
          data-bs-toggle="tab"
          id="header-tab"
          on:click={() => ($activeTab = "header")}
          role="tab"
          type="button">
          {$_("pages.theme-settings.tabs.cover")}
        </button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="pano-theme-settings-view__navbar nav-link"
          class:active={$activeTab === "navbar"}
          data-bs-target="#navbar"
          data-bs-toggle="tab"
          id="navbar-tab"
          on:click={() => ($activeTab = "navbar")}
          role="tab"
          type="button">
          {$_("pages.theme-settings.tabs.navbar")}
        </button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="pano-theme-settings-view__sidebar nav-link"
          class:active={$activeTab === "sidebar"}
          data-bs-target="#sidebar"
          data-bs-toggle="tab"
          id="sidebar-tab"
          on:click={() => ($activeTab = "sidebar")}
          role="tab"
          type="button">
          {$_("pages.theme-settings.tabs.sidebar")}
        </button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="pano-theme-settings-view__post-card nav-link"
          class:active={$activeTab === "post-card"}
          data-bs-target="#post-card"
          data-bs-toggle="tab"
          id="post-card-tab"
          on:click={() => ($activeTab = "post-card")}
          role="tab"
          type="button">
          {$_("pages.theme-settings.tabs.post-card")}
        </button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="pano-theme-settings-view__play-card nav-link"
          class:active={$activeTab === "play-card"}
          data-bs-target="#play-card"
          data-bs-toggle="tab"
          id="play-card-tab"
          on:click={() => ($activeTab = "play-card")}
          role="tab"
          type="button">
          {$_("pages.theme-settings.tabs.play-card")}
        </button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="pano-theme-settings-view__footer nav-link"
          class:active={$activeTab === "footer"}
          data-bs-target="#footer"
          data-bs-toggle="tab"
          id="footer-tab"
          on:click={() => ($activeTab = "footer")}
          role="tab"
          type="button">
          {$_("pages.theme-settings.tabs.footer")}
        </button>
      </li>
      <li class="nav-item" role="presentation">
        <button
          class="pano-theme-settings-view__advanced nav-link"
          class:active={$activeTab === "advanced"}
          data-bs-target="#advanced"
          data-bs-toggle="tab"
          id="advanced-tab"
          on:click={() => ($activeTab = "advanced")}
          role="tab"
          type="button">
          {$_("pages.theme-settings.tabs.advanced")}
        </button>
      </li>
    </ul>
  </div>
  <div class="pano-theme-settings-view__body card-body">
    <div class="tab-content">
      <!-- General -->
      <div
        class="tab-pane fade"
        class:show={$activeTab === "general"}
        class:active={$activeTab === "general"}
        id="general"
        role="tabpanel">
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="theme-color"
            >{$_("pages.theme-settings.general.theme-color")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__select form-select"
              id="theme-color"
              on:change={onThemeColorChange}
              value={$themeSettings.themeColor || "dark"}>
              <option value="dark"
                >{$_("pages.theme-settings.general.colors.dark")}</option>
              <option value="light"
                >{$_("pages.theme-settings.general.colors.light")}</option>
              <option value="copper"
                >{$_("pages.theme-settings.general.colors.copper")}</option>
              <option value="emerald"
                >{$_("pages.theme-settings.general.colors.emerald")}</option>
              <option value="midnight"
                >{$_("pages.theme-settings.general.colors.midnight")}</option>
              <option value="crimson"
                >{$_("pages.theme-settings.general.colors.crimson")}</option>
            </select>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="bgColor"
            >{$_("pages.theme-settings.general.bg-color")}</label>
          <div class="col-md-6">
            <input
              id="bgColor"
              class="pano-theme-settings-view__input form-control form-control-color"
              type="color"
              on:input={(e) => ($themeSettings.backgroundColor = e.target.value)}
              value={$themeSettings.backgroundColor || "#f5f7fa"} />
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="breadcrumb-enabled"
            >{$_("pages.theme-settings.general.breadcrumb")}</label>
          <div class="col-md-6 d-flex align-items-center">
            <div class="form-check form-switch">
              <input
                checked={$themeSettings.breadcrumbEnabled}
                class="pano-theme-settings-view__check form-check-input"
                id="breadcrumb-enabled"
                on:change={(e) =>
                  ($themeSettings.breadcrumbEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="background-image-upload"
            >{$_("pages.theme-settings.general.bg-image")}</label>
          <div class="col-md-6">
            {#if $themeSettings.files?.backgroundImage}
              <div class="input-group">
                <img
                  alt={$_("pages.theme-settings.general.bg-image")}
                  class="pano-theme-settings-view__image border rounded-start"
                  style="object-fit: contain;"
                  width="71"
                  height="40"
                  src={"/api/v1/theme/file/" +
                    $themeSettings.files.backgroundImage} />
                <input
                  id="background-image-upload"
                  class="pano-theme-settings-view__input-2 form-control"
                  type="file"
                  accept="image/*"
                  bind:files={$backgroundImageFiles}
                  on:change={onBackgroundImageChange} />
                <button
                  class="pano-theme-settings-view__action btn btn-outline-danger shadow-none rounded-end"
                  on:click={onRemoveBackgroundImageClick}
                  >{$_("buttons.remove")}</button>
              </div>
            {:else}
              <input
                id="background-image-upload"
                class="pano-theme-settings-view__input-3 form-control"
                type="file"
                accept="image/*"
                bind:files={$backgroundImageFiles}
                on:change={onBackgroundImageChange} />
            {/if}
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="bg-image-position"
            >{$_("pages.theme-settings.general.bg-image-placement")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__left-top form-select"
              id="bg-image-position"
              on:change={(e) =>
                ($themeSettings.bgImagePosition = e.target.value)}
              value={$themeSettings.bgImagePosition || "center center"}>
              <option value="left top"
                >{$_(
                  "pages.theme-settings.general.placements.left-top",
                )}</option>
              <option value="center center"
                >{$_("pages.theme-settings.general.placements.center")}</option>
              <option value="right bottom"
                >{$_(
                  "pages.theme-settings.general.placements.right-bottom",
                )}</option>
            </select>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="bg-image-repeat"
            >{$_("pages.theme-settings.general.bg-image-repeat")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__repeat form-select"
              id="bg-image-repeat"
              on:change={(e) => ($themeSettings.bgImageRepeat = e.target.value)}
              value={$themeSettings.bgImageRepeat || "no-repeat"}>
              <option value="repeat"
                >{$_("pages.theme-settings.general.repeats.repeat")}</option>
              <option value="no-repeat"
                >{$_("pages.theme-settings.general.repeats.no-repeat")}</option>
              <option value="repeat-x"
                >{$_("pages.theme-settings.general.repeats.repeat-x")}</option>
              <option value="repeat-y"
                >{$_("pages.theme-settings.general.repeats.repeat-y")}</option>
            </select>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="background-image-position"
            >{$_("pages.theme-settings.general.bg-image-size")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__auto form-select"
              id="background-image-position"
              on:change={(e) => ($themeSettings.bgImageSize = e.target.value)}
              value={$themeSettings.bgImageSize || "auto"}>
              <option value="auto"
                >{$_("pages.theme-settings.general.sizes.auto")}</option>
              <option value="cover"
                >{$_("pages.theme-settings.general.sizes.cover")}</option>
              <option value="contain"
                >{$_("pages.theme-settings.general.sizes.contain")}</option>
              <option value="100% 100%"
                >{$_("pages.theme-settings.general.sizes.stretch")}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Logo -->
      <div class="tab-pane fade" id="logo" role="tabpanel">
        <div class="row mb-3">
          <label class="col-md-6" for="logo-visibility"
            >{$_("pages.theme-settings.logo.visibility")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.logoVisibility === "undefined"
                  ? true
                  : $themeSettings.logoVisibility}
                class="pano-theme-settings-view__check-2 form-check-input"
                id="logo-visibility"
                on:change={(e) =>
                  ($themeSettings.logoVisibility = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="logoPosition"
            >{$_("pages.theme-settings.logo.position")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__top-start form-select"
              id="logoPosition"
              on:change={(e) => ($themeSettings.logoPosition = e.target.value)}
              value={$themeSettings.logoPosition || "CENTER"}>
              <option value="TOP_START"
                >{$_("pages.theme-settings.logo.positions.top-start")}</option>
              <option value="TOP"
                >{$_("pages.theme-settings.logo.positions.top")}</option>
              <option value="TOP_END"
                >{$_("pages.theme-settings.logo.positions.top-end")}</option>
              <option value="CENTER_START"
                >{$_(
                  "pages.theme-settings.logo.positions.center-start",
                )}</option>
              <option value="CENTER"
                >{$_("pages.theme-settings.logo.positions.center")}</option>
              <option value="CENTER_END"
                >{$_("pages.theme-settings.logo.positions.center-end")}</option>
              <option value="BOTTOM_START"
                >{$_(
                  "pages.theme-settings.logo.positions.bottom-start",
                )}</option>
              <option value="BOTTOM"
                >{$_("pages.theme-settings.logo.positions.bottom")}</option>
              <option value="BOTTOM_END"
                >{$_("pages.theme-settings.logo.positions.bottom-end")}</option>
            </select>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="logo-height"
            >{$_("pages.theme-settings.logo.height")}</label>
          <div class="col-md-6">
            <input
              id="logo-height"
              class="pano-theme-settings-view__input-4 form-control"
              type="number"
              on:input={(e) => ($themeSettings.logoHeight = e.target.value)}
              placeholder="auto"
              value={$themeSettings.logoHeight} />
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="logo-width"
            >{$_("pages.theme-settings.logo.width")}</label>
          <div class="col-md-6">
            <input
              id="logo-width"
              class="pano-theme-settings-view__input-5 form-control"
              type="number"
              on:input={(e) => ($themeSettings.logoWidth = e.target.value)}
              placeholder="256"
              value={$themeSettings.logoWidth} />
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="logoAnimation"
            >{$_("pages.theme-settings.logo.animation")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__off form-select"
              id="logoAnimation"
              on:change={(e) => ($themeSettings.logoAnimation = e.target.value)}
              value={$themeSettings.logoAnimation || "off"}>
              <option value="off"
                >{$_("pages.theme-settings.logo.animations.off")}</option>
              <option value="zoom"
                >{$_("pages.theme-settings.logo.animations.zoom")}</option>
              <option value="floating"
                >{$_("pages.theme-settings.logo.animations.floating")}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Header -->
      <div class="tab-pane fade" id="header" role="tabpanel">
        <div class="row mb-3">
          <label class="col-md-6" for="logo-visibility"
            >{$_("pages.theme-settings.cover.default-bg")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={$defaultHeaderBg}
                class="pano-theme-settings-view__check-3 form-check-input"
                id="logo-visibility"
                on:change={(e) =>
                  ($themeSettings.defaultHeaderBg = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="headerBackgroundImage"
            >{$_("pages.theme-settings.cover.bg-image")}</label>
          <div class="col-md-6">
            {#if $themeSettings.files?.headerBackgroundImage || $defaultHeaderBg}
              <div class="input-group">
                <div style="height: 40px; width: 150px;">
                  <img
                    alt={$_("pages.theme-settings.cover.bg-image")}
                    class="pano-theme-settings-view__bg-image border rounded-start"
                    style="height: 100%; width: 100%; object-fit: cover;"
                    src={$defaultHeaderBg
                      ? "/assets/img/default-header-bg.png"
                      : "/api/v1/theme/file/" +
                        $themeSettings.files.headerBackgroundImage} />
                </div>

                <input
                  id="headerBackgroundImage"
                  class="pano-theme-settings-view__input-6 form-control"
                  type="file"
                  accept="image/*"
                  bind:files={$headerBackgroundImageFiles}
                  on:change={onHeaderBackgroundImageChange}
                  disabled={$defaultHeaderBg} />

                <button
                  class="pano-theme-settings-view__remove btn btn-outline-danger shadow-none rounded-end"
                  on:click={onRemoveHeaderBackgroundImageClick}
                  class:disabled={$defaultHeaderBg}
                  >{$_("buttons.remove")}</button>
              </div>
            {:else}
              <input
                id="headerBackgroundImage"
                class="pano-theme-settings-view__input-7 form-control"
                type="file"
                accept="image/*"
                bind:files={$headerBackgroundImageFiles}
                on:change={onHeaderBackgroundImageChange} />
            {/if}
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="headerBgImagePosition"
            >{$_("pages.theme-settings.general.bg-image-placement")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__select-2 form-select"
              id="headerBgImagePosition"
              on:change={(e) =>
                ($themeSettings.headerBgImagePosition = e.target.value)}
              value={$themeSettings.headerBgImagePosition || "center center"}>
              <option value="left top"
                >{$_(
                  "pages.theme-settings.general.placements.left-top",
                )}</option>
              <option value="center center"
                >{$_("pages.theme-settings.general.placements.center")}</option>
              <option value="right bottom"
                >{$_(
                  "pages.theme-settings.general.placements.right-bottom",
                )}</option>
            </select>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="headerBgImageRepeat"
            >{$_("pages.theme-settings.general.bg-image-repeat")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__select-3 form-select"
              id="headerBgImageRepeat"
              on:change={(e) =>
                ($themeSettings.headerBgImageRepeat = e.target.value)}
              value={$themeSettings.headerBgImageRepeat || "no-repeat"}>
              <option value="repeat"
                >{$_("pages.theme-settings.general.repeats.repeat")}</option>
              <option value="no-repeat"
                >{$_("pages.theme-settings.general.repeats.no-repeat")}</option>
              <option value="repeat-x"
                >{$_("pages.theme-settings.general.repeats.repeat-x")}</option>
              <option value="repeat-y"
                >{$_("pages.theme-settings.general.repeats.repeat-y")}</option>
            </select>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="headerBgImageSize"
            >{$_("pages.theme-settings.general.bg-image-size")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__select-4 form-select"
              id="headerBgImageSize"
              on:change={(e) =>
                ($themeSettings.headerBgImageSize = e.target.value)}
              value={$themeSettings.headerBgImageSize || "cover"}>
              <option value="auto"
                >{$_("pages.theme-settings.general.sizes.auto")}</option>
              <option value="cover"
                >{$_("pages.theme-settings.general.sizes.cover")}</option>
              <option value="contain"
                >{$_("pages.theme-settings.general.sizes.contain")}</option>
              <option value="100% 100%"
                >{$_("pages.theme-settings.general.sizes.stretch")}</option>
            </select>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="headerBgColor"
            >{$_("pages.theme-settings.cover.bg-color")}</label>
          <div class="col-md-6">
            <input
              id="headerBgColor"
              class="pano-theme-settings-view__input-8 form-control form-control-color"
              type="color"
              on:input={(e) => ($themeSettings.headerBgColor = e.target.value)}
              value={$themeSettings.headerBgColor || $currentThemeDefault.header} />
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="headerHeight"
            >{$_("pages.theme-settings.cover.height")}</label>
          <div class="col-md-6">
            <input
              class="pano-theme-settings-view__input-9 form-control"
              id="headerHeight"
              on:input={(e) => ($themeSettings.headerHeight = e.target.value)}
              placeholder="auto"
              type="number"
              value={$themeSettings.headerHeight} />
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="headerWidthOption"
            >{$_("pages.theme-settings.cover.width")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__by-content form-select"
              id="headerWidthOption"
              on:change={(e) =>
                ($themeSettings.headerWidthOption = e.target.value)}
              value={$themeSettings.headerWidthOption || "FULL_SIZE"}>
              <option value="BY_CONTENT"
                >{$_(
                  "pages.theme-settings.cover.width-options.by-content",
                )}</option>
              <option value="FULL_SIZE"
                >{$_(
                  "pages.theme-settings.cover.width-options.full-size",
                )}</option>
            </select>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="headerNavBarGap"
            >{$_("pages.theme-settings.cover.nav-gap")}</label>
          <div class="col-md-6">
            <input
              class="form-range"
              id="headerNavBarGap"
              max="5"
              min="0"
              on:input={(e) => ($themeSettings.headerNavBarGap = e.target.value)}
              type="range"
              value={$themeSettings.headerNavBarGap || "3"} />
            <output aria-hidden="true" for="headerNavBarGap"
              >{$themeSettings.headerNavBarGap || "3"}</output>
          </div>
        </div>
      </div>

      <!-- Navbar -->
      <div class="tab-pane fade" id="navbar" role="tabpanel">
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="navbarWidthOption"
            >{$_("pages.theme-settings.navbar.width")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__select-5 form-select"
              id="navbarWidthOption"
              on:change={(e) =>
                ($themeSettings.navbarWidthOption = e.target.value)}
              value={$themeSettings.navbarWidthOption || "BY_CONTENT"}>
              <option value="BY_CONTENT"
                >{$_(
                  "pages.theme-settings.cover.width-options.by-content",
                )}</option>
              <option value="FULL_SIZE"
                >{$_(
                  "pages.theme-settings.cover.width-options.full-size",
                )}</option>
            </select>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="navbarBgColor"
            >{$_("pages.theme-settings.navbar.bg-color")}</label>
          <div class="col-md-6">
            <input
              id="navbarBgColor"
              class="pano-theme-settings-view__input-10 form-control form-control-color"
              type="color"
              on:input={(e) => ($themeSettings.navbarBgColor = e.target.value)}
              value={$themeSettings.navbarBgColor || $currentThemeDefault.navbar} />
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="navRoundEnabled"
            >{$_("pages.theme-settings.navbar.border-radius")}</label>
          <div class="col-md-6">
            <input
              class="form-range"
              id="headerNavBarGap"
              max="5"
              min="0"
              on:input={(e) => ($themeSettings.navRoundLevel = e.target.value)}
              type="range"
              value={$themeSettings.navRoundLevel || 5} />
            <output aria-hidden="true" for="headerNavBarGap"
              >{$themeSettings.navRoundLevel || "5"}</output>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6" for="logo-visibility"
            >{$_("pages.theme-settings.navbar.links-visibility")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.navLinksEnabled === "undefined"
                  ? true
                  : $themeSettings.navLinksEnabled}
                class="pano-theme-settings-view__check-4 form-check-input"
                id="logo-visibility"
                on:change={(e) =>
                  ($themeSettings.navLinksEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="navbarLinks"
            >{$_("pages.theme-settings.navbar.links")}</label>
          <div class="col-md-6" id="navbarLinks">
            <ul class="pano-theme-settings-view__list list-group">
              {#each $orderedNavLinks as link, index (link.id)}
                <li
                  class="pano-theme-settings-view__item list-group-item d-flex justify-content-between align-items-center drag-item"
                  class:dragging={$draggingItemIndex === index}
                  class:drag-over={$dragOverItemIndex === index && $draggingItemIndex !== index}
                  draggable="true"
                  on:dragstart={(e) => onDragStart(e, index)}
                  on:dragover={(e) => onDragOver(e, index)}
                  on:dragend={onDragEnd}
                  on:drop={(e) => onDrop(e, index, "nav")}
                  style="cursor: move;">
                  <div class="d-flex align-items-center gap-2">
                    <i class="fa fa-bars text-muted"></i>
                    <span>
                      {#if link.isPlugin}
                        {link.text && link.text.includes(".")
                          ? $_(link.text)
                          : link.text}
                        <span class="pano-theme-settings-view__badge badge text-bg-secondary opacity-50 ms-1" style="font-size: 0.6rem;">
                          <i class="fa-solid fa-plug me-1"></i>{$_("labels.plugin")}
                        </span>
                      {:else}
                        {$_(link.text)}
                      {/if}
                    </span>
                  </div>
                  <div class="form-check form-switch m-0">
                    <input
                      class="pano-theme-settings-view__check-5 form-check-input"
                      type="checkbox"
                      checked={$themeSettings.navLinksEnableStatus?.[link.id] ?? true}
                      on:change={(e) => toggleLink(link.id, e.target.checked)} />
                  </div>
                </li>
              {/each}
            </ul>
            <div class="form-text mt-2">
              {$_("pages.theme-settings.navbar.drag-drop-hint") || "Linkleri sürükleyip bırakarak sıralayabilirsiniz."}
            </div>
          </div>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="tab-pane fade" id="sidebar" role="tabpanel">
        <div class="row mb-3">
          <label class="col-md-6" for="sidebarVisibility"
            >{$_("pages.theme-settings.sidebar.visibility")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.sidebarEnabled === "undefined"
                  ? true
                  : $themeSettings.sidebarEnabled}
                class="pano-theme-settings-view__check-6 form-check-input"
                id="sidebarVisibility"
                on:change={(e) =>
                  ($themeSettings.sidebarEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="sidebarPosition"
            >{$_("pages.theme-settings.sidebar.position")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__left form-select"
              id="sidebarPosition"
              on:change={(e) =>
                ($themeSettings.sidebarPosition = e.target.value)}
              value={$themeSettings.sidebarPosition || "RIGHT"}>
              <option value="LEFT"
                >{$_("pages.theme-settings.sidebar.positions.left")}</option>
              <option value="RIGHT"
                >{$_("pages.theme-settings.sidebar.positions.right")}</option>
            </select>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="lastRegistrantsCartVisibility"
            >{$_("pages.theme-settings.sidebar.last-registrants")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.sidebarCarts?.lastRegistrants ===
                "undefined"
                  ? true
                  : $themeSettings.sidebarCarts?.lastRegistrants}
                class="pano-theme-settings-view__check-7 form-check-input"
                id="lastRegistrantsCartVisibility"
                on:change={(e) => {
                  if (!$themeSettings.sidebarCarts)
                    $themeSettings.sidebarCarts = {};
                  $themeSettings.sidebarCarts.lastRegistrants = e.target.checked;
                }}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6" for="onlineAdminsCartVisibility"
            >{$_("pages.theme-settings.sidebar.online-admins")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.sidebarCarts?.onlineAdmins ===
                "undefined"
                  ? true
                  : $themeSettings.sidebarCarts?.onlineAdmins}
                class="pano-theme-settings-view__check-8 form-check-input"
                id="onlineAdminsCartVisibility"
                on:change={(e) => {
                  if (!$themeSettings.sidebarCarts)
                    $themeSettings.sidebarCarts = {};
                  $themeSettings.sidebarCarts.onlineAdmins = e.target.checked;
                }}
                type="checkbox" />
            </div>
          </div>
        </div>
      </div>

      <div
        class="tab-pane fade"
        class:active={$activeTab === "play-card"}
        class:show={$activeTab === "play-card"}
        id="play-card"
        role="tabpanel">
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="playCardStyle"
            >{$_("pages.theme-settings.sidebar.play-card-style")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__style-2 form-select"
              id="playCardStyle"
              on:change={(e) => {
                $themeSettings.playCardStyle = e.target.value;
                $themeSettings = $themeSettings;
              }}
              value={$themeSettings.playCardStyle || "style-2"}>
              <option value="style-2"
                >{$_("pages.theme-settings.sidebar.play-card-styles.style-2")}</option>
              <option value="style-1"
                >{$_("pages.theme-settings.sidebar.play-card-styles.style-1")}</option>
            </select>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="defaultPlayCardBg"
            >{$_("pages.theme-settings.sidebar.play-card-default-bg")}</label>
          <div class="col-md-6 d-flex align-items-center">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.defaultPlayCardBg === "undefined"
                  ? true
                  : $themeSettings.defaultPlayCardBg}
                class="pano-theme-settings-view__check-9 form-check-input"
                id="defaultPlayCardBg"
                on:change={(e) => {
                  $themeSettings.defaultPlayCardBg = e.target.checked;
                  $themeSettings = $themeSettings;
                }}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="playCardBgImage"
            >{$_("pages.theme-settings.sidebar.play-card-bg-image")}</label>
          <div class="col-md-6">
            {#if $themeSettings.files?.playCardBackgroundImage || (typeof $themeSettings.defaultPlayCardBg === "undefined" ? true : $themeSettings.defaultPlayCardBg)}
              <div class="input-group">
                <div style="height: 40px; width: 150px;">
                  <img
                    alt={$_("pages.theme-settings.sidebar.play-card-bg-image")}
                    class="pano-theme-settings-view__play-card-bg-image border rounded-start"
                    style="height: 100%; width: 100%; object-fit: cover;"
                    src={$themeSettings.files?.playCardBackgroundImage
                      ? "/api/v1/theme/file/" +
                        $themeSettings.files.playCardBackgroundImage
                      : (typeof $themeSettings.defaultHeaderBg === "undefined"
                        ? true
                        : $themeSettings.defaultHeaderBg) ||
                        !$themeSettings.files?.headerBackgroundImage
                        ? "/assets/img/default-header-bg.png"
                        : "/api/v1/theme/file/" +
                          $themeSettings.files.headerBackgroundImage} />
                </div>

                <input
                  id="playCardBgImage"
                  class="pano-theme-settings-view__input-11 form-control"
                  on:change={onPlayCardBackgroundImageChange}
                  bind:files={$playCardBackgroundImageFiles}
                  disabled={typeof $themeSettings.defaultPlayCardBg === "undefined" ? true : $themeSettings.defaultPlayCardBg}
                  type="file" />
                <button
                  class="pano-theme-settings-view__action-2 btn btn-outline-danger"
                  class:disabled={typeof $themeSettings.defaultPlayCardBg === "undefined" ? true : $themeSettings.defaultPlayCardBg}
                  on:click={onRemovePlayCardBackgroundImageClick}
                  type="button">
                  {$_("buttons.remove")}
                </button>
              </div>
            {:else}
              <input
                bind:files={$playCardBackgroundImageFiles}
                class="pano-theme-settings-view__input-12 form-control"
                id="playCardBgImage"
                on:change={onPlayCardBackgroundImageChange}
                type="file" />
            {/if}
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="playCardBgOpacity"
            >{$_("pages.theme-settings.sidebar.play-card-bg-opacity")}</label>
          <div class="col-md-6">
            <input
              class="form-range"
              id="playCardBgOpacity"
              max="1"
              min="0"
              step="0.05"
              on:input={(e) => {
                $themeSettings.playCardBgOpacity = parseFloat(e.target.value);
                $themeSettings = $themeSettings;
              }}
              type="range"
              value={$themeSettings.playCardBgOpacity ?? 0.5} />
            <div class="text-end small">
              {Math.round(($themeSettings.playCardBgOpacity ?? 0.5) * 100)}%
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="playCardBgEffect"
            >{$_("pages.theme-settings.sidebar.play-card-bg-effect")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__solid form-select"
              id="playCardBgEffect"
              on:change={(e) => {
                $themeSettings.playCardBgEffect = e.target.value;
                $themeSettings = $themeSettings;
              }}
              value={$themeSettings.playCardBgEffect || "solid"}>
              <option value="solid"
                >{$_("pages.theme-settings.sidebar.play-card-bg-effects.solid")}</option>
              <option value="gradient"
                >{$_("pages.theme-settings.sidebar.play-card-bg-effects.gradient")}</option>
            </select>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="playCardIpText"
            >{$_("pages.theme-settings.sidebar.play-card-ip-text")}</label>
          <div class="col-md-6">
            <input
              class="pano-theme-settings-view__input-13 form-control"
              id="playCardIpText"
              on:input={(e) => {
                $themeSettings.playCardIpText = e.target.value;
                $themeSettings = $themeSettings;
              }}
              placeholder={$session.siteInfo.serverIp}
              type="text"
              value={$themeSettings.playCardIpText || $session.siteInfo.serverIp} />
            <div class="small opacity-75 mt-1">
              {$_("pages.theme-settings.sidebar.play-card-ip-text-hint")}
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="playCardStatusBadge"
            >{$_("pages.theme-settings.sidebar.play-card-status-badge")}</label>
          <div class="col-md-6 d-flex align-items-center">
            <div class="form-check form-switch">
              <input
                checked={$themeSettings.playCardStatusBadge ?? true}
                class="pano-theme-settings-view__check-10 form-check-input"
                id="playCardStatusBadge"
                on:change={(e) => {
                  $themeSettings.playCardStatusBadge = e.target.checked;
                  $themeSettings = $themeSettings;
                }}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="playCardPlayerCount"
            >{$_("pages.theme-settings.sidebar.play-card-player-count")}</label>
          <div class="col-md-6 d-flex align-items-center">
            <div class="form-check form-switch">
              <input
                checked={$themeSettings.playCardPlayerCount ?? true}
                class="pano-theme-settings-view__check-11 form-check-input"
                id="playCardPlayerCount"
                on:change={(e) => {
                  $themeSettings.playCardPlayerCount = e.target.checked;
                  $themeSettings = $themeSettings;
                }}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="playCardVersionInfo"
            >{$_("pages.theme-settings.sidebar.play-card-version-info")}</label>
          <div class="col-md-6 d-flex align-items-center">
            <div class="form-check form-switch">
              <input
                checked={$themeSettings.playCardVersionInfo ?? true}
                class="pano-theme-settings-view__check-12 form-check-input"
                id="playCardVersionInfo"
                on:change={(e) => {
                  $themeSettings.playCardVersionInfo = e.target.checked;
                  $themeSettings = $themeSettings;
                }}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="playCardIpColor"
            >{$_("pages.theme-settings.sidebar.play-card-ip-color")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__default form-select"
              id="playCardIpColor"
              on:change={(e) => {
                $themeSettings.playCardIpColor = e.target.value;
                $themeSettings = $themeSettings;
              }}
              value={$themeSettings.playCardIpColor || "default"}>
              <option value="default"
                >{$_("pages.theme-settings.sidebar.default")}</option>
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
              <option value="success">Success</option>
              <option value="danger">Danger</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="playCardBorderColor"
            >{$_("pages.theme-settings.sidebar.play-card-border-color")}</label>
          <div class="col-md-6">
            <select
              class="pano-theme-settings-view__select-6 form-select"
              id="playCardBorderColor"
              on:change={(e) => {
                $themeSettings.playCardBorderColor = e.target.value;
                $themeSettings = $themeSettings;
              }}
              value={$themeSettings.playCardBorderColor || "default"}>
              <option value="default"
                >{$_("pages.theme-settings.sidebar.default")}</option>
              <option value="border-primary">Primary</option>
              <option value="border-secondary">Secondary</option>
              <option value="border-success">Success</option>
              <option value="border-danger">Danger</option>
              <option value="border-warning">Warning</option>
              <option value="border-info">Info</option>
              <option value="border-light">Light</option>
              <option value="border-dark">Dark</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Post Card -->
      <div class="tab-pane fade" id="post-card" role="tabpanel">
        <div class="row mb-3">
          <label class="col-md-6" for="postsEnabled"
            >{$_("pages.theme-settings.post-card.visibility")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.postsEnabled === "undefined"
                  ? true
                  : $themeSettings.postsEnabled}
                class="pano-theme-settings-view__check-13 form-check-input"
                id="postsEnabled"
                on:change={(e) =>
                  ($themeSettings.postsEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="postCoverImageEnabled"
            >{$_("pages.theme-settings.post-card.cover-image")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.postCoverImageEnabled ===
                "undefined"
                  ? true
                  : $themeSettings.postCoverImageEnabled}
                class="pano-theme-settings-view__check-14 form-check-input"
                id="postCoverImageEnabled"
                on:change={(e) =>
                  ($themeSettings.postCoverImageEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="postReadMoreButtonEnabled"
            >{$_("pages.theme-settings.post-card.read-more")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.postReadMoreButtonEnabled ===
                "undefined"
                  ? true
                  : $themeSettings.postReadMoreButtonEnabled}
                class="pano-theme-settings-view__check-15 form-check-input"
                id="postReadMoreButtonEnabled"
                on:change={(e) =>
                  ($themeSettings.postReadMoreButtonEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="postAuthorImageEnabled"
            >{$_("pages.theme-settings.post-card.author-image")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.postAuthorImageEnabled ===
                "undefined"
                  ? true
                  : $themeSettings.postAuthorImageEnabled}
                class="pano-theme-settings-view__check-16 form-check-input"
                id="postAuthorImageEnabled"
                on:change={(e) =>
                  ($themeSettings.postAuthorImageEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="postViewCountEnabled"
            >{$_("pages.theme-settings.post-card.views")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.postViewCountEnabled ===
                "undefined"
                  ? true
                  : $themeSettings.postViewCountEnabled}
                class="pano-theme-settings-view__check-17 form-check-input"
                id="postViewCountEnabled"
                on:change={(e) =>
                  ($themeSettings.postViewCountEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="postPreviousPageEnabled"
            >{$_("pages.theme-settings.post-card.previous-post")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.postPreviousPageEnabled ===
                "undefined"
                  ? true
                  : $themeSettings.postPreviousPageEnabled}
                class="pano-theme-settings-view__check-18 form-check-input"
                id="postPreviousPageEnabled"
                on:change={(e) =>
                  ($themeSettings.postPreviousPageEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="postNextPageEnabled"
            >{$_("pages.theme-settings.post-card.next-post")}</label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.postNextPageEnabled ===
                "undefined"
                  ? true
                  : $themeSettings.postNextPageEnabled}
                class="pano-theme-settings-view__check-19 form-check-input"
                id="postNextPageEnabled"
                on:change={(e) =>
                  ($themeSettings.postNextPageEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="tab-pane fade" id="footer" role="tabpanel">
        <div class="row mb-3">
          <label class="col-md-6" for="footerEnabled">
            {$_("pages.theme-settings.footer.visibility")}
          </label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={typeof $themeSettings.footerEnabled === "undefined"
                  ? true
                  : $themeSettings.footerEnabled}
                class="pano-theme-settings-view__check-20 form-check-input"
                id="footerEnabled"
                on:change={(e) =>
                  ($themeSettings.footerEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="footerLogoEnabled">
            {$_("pages.theme-settings.footer.logo-visibility")}
          </label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={$themeSettings.footerLogoEnabled ?? true}
                class="pano-theme-settings-view__check-21 form-check-input"
                id="footerLogoEnabled"
                on:change={(e) =>
                  ($themeSettings.footerLogoEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="footerTitleEnabled">
            {$_("pages.theme-settings.footer.title-visibility")}
          </label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={$themeSettings.footerTitleEnabled ?? true}
                class="pano-theme-settings-view__check-22 form-check-input"
                id="footerTitleEnabled"
                on:change={(e) =>
                  ($themeSettings.footerTitleEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="footerTitle">
            {$_("pages.theme-settings.footer.title")}
          </label>
          <div class="col-md-6">
            <input
              class="pano-theme-settings-view__input-14 form-control"
              id="footerTitle"
              on:input={(e) => ($themeSettings.footerTitle = e.target.value)}
              type="text"
              value={$themeSettings.footerTitle ?? $session.siteInfo.websiteName} />
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6" for="footerContentEnabled">
            {$_("pages.theme-settings.footer.content-visibility")}
          </label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={$themeSettings.footerContentEnabled ?? true}
                class="pano-theme-settings-view__check-23 form-check-input"
                id="footerContentEnabled"
                on:change={(e) =>
                  ($themeSettings.footerContentEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>
        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="footerContent">
            {$_("pages.theme-settings.footer.content")}
          </label>
          <div class="col-md-6">
            <textarea
              class="pano-theme-settings-view__input-15 form-control"
              id="footerContent"
              on:input={(e) => ($themeSettings.footerContent = e.target.value)}
              style="height: 200px;"
              value={$themeSettings.footerContent ?? $session.siteInfo.websiteDescription}></textarea>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6" for="footer-links-visibility">
            {$_("pages.theme-settings.footer.links-visibility")}
          </label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={$themeSettings.footerLinksEnabled ?? true}
                class="pano-theme-settings-view__check-24 form-check-input"
                id="footer-links-visibility"
                on:change={(e) =>
                  ($themeSettings.footerLinksEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6" for="footer-plugin-links-visibility">
            {$_("pages.theme-settings.footer.plugin-links-visibility")}
          </label>
          <div class="col-md-6">
            <div class="form-check form-switch">
              <input
                checked={$themeSettings.footerPluginLinksEnabled ?? true}
                class="pano-theme-settings-view__check-25 form-check-input"
                id="footer-plugin-links-visibility"
                on:change={(e) =>
                  ($themeSettings.footerPluginLinksEnabled = e.target.checked)}
                type="checkbox" />
            </div>
          </div>
        </div>

        <div class="row mb-3">
          <label class="col-md-6 col-form-label" for="footerLinks">
            {$_("pages.theme-settings.footer.links")}
          </label>
          <div class="col-md-6" id="footerLinks">
            <ul class="pano-theme-settings-view__plugin list-group">
              {#each $orderedFooterLinks as link, index (link.id)}
                {#if !link.isPlugin || ($themeSettings.footerPluginLinksEnabled ?? true)}
                  <li
                    class="pano-theme-settings-view__item-2 list-group-item d-flex justify-content-between align-items-center drag-item"
                    class:dragging={$draggingItemIndex === index}
                    class:drag-over={$dragOverItemIndex === index && $draggingItemIndex !== index}
                    draggable="true"
                    on:dragstart={(e) => onDragStart(e, index)}
                    on:dragover={(e) => onDragOver(e, index)}
                    on:dragend={onDragEnd}
                    on:drop={(e) => onDrop(e, index, "footer")}
                    style="cursor: move;">
                    <div class="d-flex align-items-center gap-2">
                      <i class="fa fa-bars text-muted"></i>
                      <span>
                        {#if link.isPlugin}
                          {link.text && link.text.includes(".")
                            ? $_(link.text)
                            : link.text}
                          <span class="pano-theme-settings-view__badge-2 badge text-bg-secondary opacity-50 ms-1" style="font-size: 0.6rem;">
                            <i class="fa-solid fa-plug me-1"></i>{$_("labels.plugin")}
                          </span>
                        {:else}
                          {$_(link.text)}
                        {/if}
                      </span>
                    </div>
                    <div class="form-check form-switch m-0">
                      <input
                        class="pano-theme-settings-view__check-26 form-check-input"
                        type="checkbox"
                        checked={$themeSettings.footerLinksEnableStatus?.[
                          link.id
                        ] ?? true}
                        on:change={(e) =>
                          toggleFooterLink(link.id, e.target.checked)} />
                    </div>
                  </li>
                {/if}
              {/each}
            </ul>
            <div class="form-text mt-2">
              {$_("pages.theme-settings.navbar.drag-drop-hint") || "Linkleri sürükleyip bırakarak sıralayabilirsiniz."}
            </div>
          </div>
        </div>
      </div>

      <!-- Advanced -->
      <div class="tab-pane fade" id="advanced" role="tabpanel">
        <div class="row">
          <label class="col col-form-label" for="customCss"
            >{$_("pages.theme-settings.advanced.custom-css")}</label>
          <div class="col-6">
            <textarea
              class="pano-theme-settings-view__input-16 form-control"
              id="customCss"
              on:input={(e) => ($themeSettings.customCss = e.target.value)}
              style="height: 200px;"
              value={$themeSettings.customCss}></textarea>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-4 d-flex align-items-center gap-2 border-top pt-3">
      <button
        class="pano-theme-settings-view__save btn btn-secondary"
        class:disabled={$saving || !$tabChanged}
        on:click={save}>
        {$_("buttons.save")}
      </button>

      <button
        class="pano-theme-settings-view__reset-tab btn btn-link"
        class:disabled={$resetting || $saving}
        hidden={!$tabResetVisible}
        on:click={resetTab}>
        {$_("buttons.reset-tab")}
      </button>

      <div class="ms-auto">
        <button
          class="pano-theme-settings-view__reset-all btn btn-link link-danger"
          class:disabled={$resettingAll || $saving}
          hidden={!$allResetVisible}
          on:click={resetAll}>
          {$_("buttons.reset-all")}
        </button>
      </div>
    </div>
  </div>
</div>

<script>
  import { _ } from "svelte-i18n";

  export let data;
  export let themeSettings;
  export let session;
  export let activeTab;
  export let saving;
  export let resetting;
  export let resettingAll;
  export let backgroundImageFiles;
  export let headerBackgroundImageFiles;
  export let playCardBackgroundImageFiles;
  export let currentThemeDefault;
  export let defaultHeaderBg;
  export let orderedNavLinks;
  export let orderedFooterLinks;
  export let draggingItemIndex;
  export let dragOverItemIndex;
  export let tabChanged;
  export let tabResetVisible;
  export let allResetVisible;
  export let onThemeColorChange;
  export let onBackgroundImageChange;
  export let onRemoveBackgroundImageClick;
  export let onHeaderBackgroundImageChange;
  export let onRemoveHeaderBackgroundImageClick;
  export let onPlayCardBackgroundImageChange;
  export let onRemovePlayCardBackgroundImageClick;
  export let onDragStart;
  export let onDragOver;
  export let onDragEnd;
  export let onDrop;
  export let toggleLink;
  export let toggleFooterLink;
  export let save;
  export let resetTab;
  export let resetAll;
</script>

<style>
    .drag-item {
        transition: transform 0.2s ease, background-color 0.2s ease;
    }

    .drag-item.dragging {
        opacity: 0.4;
        background-color: var(--bs-light);
        border-style: dashed;
    }

    .drag-item.drag-over {
        border-top: 2px solid var(--bs-primary);
        background-color: rgba(var(--bs-primary-rgb), 0.05);
    }
</style>
