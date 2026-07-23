<style>
  .demo-bubble {
    position: absolute;
    bottom: calc(100% + 15px);
    right: 0;
    background: #ffc947;
    color: #212529;
    padding: 10px 35px 10px 15px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
    z-index: 1050;
    white-space: normal;
    width: max-content;
    max-width: 260px;
    animation: bubbleFadeIn 0.3s ease-out;
  }

  .demo-bubble::before {
    content: "";
    position: absolute;
    top: 100%;
    right: 20px;
    border-width: 8px;
    border-style: solid;
    border-color: #ffc947 transparent transparent transparent;
  }

  .demo-bubble-close {
    position: absolute;
    top: 50%;
    right: 10px;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: rgba(0, 0, 0, 0.4);
    cursor: pointer;
    font-size: 14px;
    padding: 5px;
    line-height: 1;
    transition: color 0.2s;
  }

  .demo-bubble-close:hover {
    color: #000;
  }

  @keyframes bubbleFadeIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 991px) {
    .demo-bubble {
      bottom: calc(100% + 5px);
      max-width: 180px;
    }
  }
  .navbar-nav .nav-link {
    opacity: 0.95;
    transition: opacity 0.2s;
  }

  .navbar-nav .nav-link:hover,
  .navbar-nav .nav-link.active {
    opacity: 1;
  }

  .navbar {
    border: 1.5px solid rgba(255, 255, 255, 0.1) !important;
  }

  .navbar[data-bs-theme="light"] {
    border-color: rgba(0, 0, 0, 0.08) !important;
  }
</style>

<!-- Navbar -->
<div class:container={themeSettings.navbarWidthOption !== "FULL_SIZE"}>
  <nav
    data-bs-theme={getContrast(effectiveNavbarBgColor)}
    class="navbar navbar-expand-lg rounded rounded-{themeSettings.navRoundLevel
      ? +themeSettings.navRoundLevel
      : '5'} shadow-sm"
    style="background-color: {effectiveNavbarBgColor}">
    <div class="container">
      <ul class="navbar-nav flex-row me-auto">
        <li>
          <button
            aria-label={$_("buttons.toggle")}
            class="navbar-toggler d-lg-none"
            data-bs-target="#navbar"
            data-bs-toggle="collapse"
            type="button">
            <i aria-hidden="true" class="fa fa-bars"></i>
          </button>
        </li>
      </ul>

      <ul class="navbar-nav flex-row ml-auto order-lg-last gap-lg-0 gap-3">
        {#each $navbarRightComponents as component (component.id)}
          {#if component.id === "panel-button"}
            {#if $session.user && $session.user.panelAccess}
              <li class="nav-item position-relative">
                <a
                  class="nav-link"
                  href={PANEL_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={$_("nav-links.panel")}
                  use:tooltip={[
                    $_("nav-links.panel"),
                    { placement: "bottom" },
                  ]}>
                  <i class="fa-solid fa-columns"></i>
                </a>
                {#if showPanelBubble}
                  <div class="demo-bubble">
                    <div class="demo-bubble-content">
                      {$_("labels.demo-panel-hint")}
                    </div>
                    <button
                      type="button"
                      class="demo-bubble-close"
                      on:click={() => (showPanelBubble = false)}
                      aria-label="Close">
                      <i class="fa fa-times"></i>
                    </button>
                  </div>
                {/if}
              </li>
            {/if}
          {:else if component.id === "profile-dropdown"}
            {#if $session.user}
              <!-- User Dropdown -->
              <li class="nav-item dropdown position-relative">
                <button
                  type="button"
                  class="nav-link position-relative d-flex align-items-center"
                  data-bs-toggle="dropdown"
                  aria-expanded="false">
                  <span class="me-2 d-none d-lg-inline"
                    >{$session.user.username}</span>
                  <img
                    alt={$session.user.username}
                    class="rounded"
                    src="/api/profile/picture/{$session.user
                      .username}?{$avatarVersion}"
                    width="24"
                    height="24" />
                  {#if $notificationsCount !== 0}
                    <span
                      class="position-absolute top-0 end-0 badge rounded-pill bg-danger px-2 py-1">
                      {$notificationsCount}
                    </span>
                  {/if}
                </button>
                <ul class="dropdown-menu dropdown-menu-end position-absolute">
                  <h6 class="dropdown-header">{$session.user.username}</h6>
                  {#each $profileDropdownItems as item (item.id)}
                    {#if item.id === "profile"}
                      <li>
                        <a
                          class:active={matching(
                            $page.url.pathname,
                            "/profile",
                          )}
                          class="dropdown-item focus-ring"
                          href="/profile">{$_("buttons.profile")}</a>
                      </li>
                    {:else if item.id === "notifications"}
                      <li>
                        <a
                          class:active={matching(
                            $page.url.pathname,
                            "/notifications",
                          )}
                          class="dropdown-item focus-ring position-relative"
                          href="/notifications"
                          >{$_("buttons.notifications")}
                          {#if $notificationsCount !== 0}
                            <span
                              class="position-absolute top-0 badge rounded-pill bg-danger p-1 d-inline">
                            </span>
                          {/if}</a>
                      </li>
                    {:else if item.id === "tickets"}
                      <li>
                        <a
                          class:active={matching(
                            $page.url.pathname,
                            "/tickets",
                          )}
                          class="dropdown-item focus-ring"
                          href="/tickets">{$_("buttons.tickets")}</a>
                      </li>
                    {:else if item.id === "settings"}
                      <li>
                        <a
                          class:active={matching(
                            $page.url.pathname,
                            "/profile/settings",
                          )}
                          class="dropdown-item focus-ring"
                          href="/profile/settings">{$_("buttons.settings")}</a>
                      </li>
                    {:else if item.id === "logout"}
                      <li>
                        <button
                          type="button"
                          class="dropdown-item focus-ring link-danger"
                          on:click={() => logout(session)}
                          >{$_("buttons.logout")}</button>
                      </li>
                    {:else if item.props}
                      <!-- Custom plugin item -->
                      <li>
                        <a
                          class="dropdown-item focus-ring"
                          href={item.props.href}>
                          {#if item.props.icon}
                            <i class="{item.props.icon} me-2"></i>
                          {/if}
                          {item.props.text && item.props.text.includes(".")
                            ? $_(item.props.text)
                            : item.props.text}
                        </a>
                      </li>
                    {/if}
                  {/each}
                </ul>
              </li>
            {/if}
          {:else if component.id === "auth-buttons"}
            {#if !$session.user}
              <li class="nav-item position-relative me-lg-2">
                <a href="/login" class="nav-link">
                  {$_("buttons.login")}
                </a>
                {#if showLoginBubble}
                  <div class="demo-bubble">
                    <div class="demo-bubble-content">
                      {$_("labels.demo-login-hint")}
                    </div>
                    <button
                      type="button"
                      class="demo-bubble-close"
                      on:click={() => (showLoginBubble = false)}
                      aria-label="Close">
                      <i class="fa fa-times"></i>
                    </button>
                  </div>
                {/if}
              </li>
              <li class="nav-item">
                <a href="/register" class="btn btn-secondary rounded-pill">
                  {$_("buttons.register")}
                </a>
              </li>
            {/if}
          {:else}
            <!-- External plugin component -->
            <li class="nav-item">
              <ViewComponent component={component.component} />
            </li>
          {/if}
        {/each}
      </ul>

      {#if typeof themeSettings.navLinksEnabled === "undefined" ? true : themeSettings.navLinksEnabled}
        <div class="collapse navbar-collapse" id="navbar">
          <ul class="navbar-nav mr-auto mt-2 mt-lg-0 text-lg-left text-center">
            {#each displayLinks as link (link.id)}
              <li class="nav-item">
                <a
                  href={link.href}
                  target={link.target}
                  class="nav-link"
                  class:active={matching(
                    $page.url.pathname,
                    link.href,
                    link.startsWith,
                  )}
                  title={link.text && link.text.includes(".")
                    ? $_(link.text)
                    : link.text}>
                  {#if link.icon}
                    <i class="{link.icon} me-1" aria-hidden="true"></i>
                  {/if}
                  {link.text && link.text.includes(".")
                    ? $_(link.text)
                    : link.text}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </nav>
</div>

<!-- Navbar End -->
<script>
  import { getContext, onMount } from "svelte";
  import { _ } from "svelte-i18n";

  import { page } from "$app/stores";
  import { browser } from "$app/environment";
  import { PANEL_URL } from "$pano/lib/variables.js";

  import { avatarVersion, logout, notificationsCount } from "$pano/lib/Store";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";
  import { hasPermission } from "$pano/lib/auth.util.js";
  import tooltip from "$pano/lib/tooltip.util";
  import { orderLinksBySavedOrder } from "$pano/lib/orderNavLinks.util.js";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  const themeDefaults = {
    dark: "#044389",
    light: "#ffffff",
    copper: "#9c622b",
    emerald: "#0d8a61",
    midnight: "#6d44c5",
    crimson: "#bf3636"
  };

  $: effectiveNavbarBgColor =
    themeSettings.navbarBgColor ||
    themeDefaults[themeSettings.themeColor || "dark"] ||
    themeDefaults.dark;

  function getContrast(hexcolor) {
    if (!hexcolor || hexcolor.startsWith("bg-")) return "dark"; // Default dark for old classes
    hexcolor = hexcolor.replace("#", "");
    const r = parseInt(hexcolor.substr(0, 2), 16);
    const g = parseInt(hexcolor.substr(2, 2), 16);
    const b = parseInt(hexcolor.substr(4, 2), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 128 ? "light" : "dark";
  }

  const navLinks = panoApiClient.ui.nav.site.getNavLinks();

  // Initialize navbar right components
  panoApiClient.ui.nav.rightComponents.edit((items) => {
    items.push(
      { id: "panel-button", priority: 100, hidden: false },
      { id: "profile-dropdown", priority: 90, hidden: false },
      { id: "auth-buttons", priority: 80, hidden: false },
    );
  });

  // Initialize profile dropdown items
  panoApiClient.ui.nav.profileDropdown.edit((items) => {
    items.push(
      { id: "profile", priority: 100, hidden: false },
      { id: "notifications", priority: 90, hidden: false },
      { id: "tickets", priority: 80, hidden: false },
      { id: "settings", priority: 70, hidden: false },
      { id: "logout", priority: 10, hidden: false },
    );
  });

  const navbarRightComponents = panoApiClient.ui.nav.rightComponents.get();
  const profileDropdownItems = panoApiClient.ui.nav.profileDropdown.get();

  let navbarCollapseInstance = null;
  let showPanelBubble = false;
  let showLoginBubble = false;

  onMount(() => {
    const navbarElement = document.getElementById("navbar");
    if (navbarElement) {
      navbarCollapseInstance = window.bootstrap.Collapse.getOrCreateInstance(
        navbarElement,
        { toggle: false },
      );
    }
  });

  $: if (browser && $session?.siteInfo?.isDemo) {
    if (!$session?.user) {
      showPanelBubble = false;
      showLoginBubble = true;
    } else {
      showLoginBubble = false;
      showPanelBubble = !!$session?.user?.panelAccess;
    }
  }

  // Close navbar when page changes on mobile
  $: if ($page.url.pathname && navbarCollapseInstance) {
    navbarCollapseInstance.hide();
  }

  const session = getContext("session");
  const themeSettings = getContext("themeSettings");

  $: navbarWidthOption = themeSettings.navbarWidthOption || "BY_CONTENT";

  $: nativeLinks = [
    { id: "home", text: "nav-links.homepage", href: "/" },
    { id: "support", text: "nav-links.support", href: "/support" },
    {
      id: "rules",
      text: "nav-links.rules",
      href: "/rules",
      condition: !!$session.siteInfo?.hasRegisterAgreement
    },
  ];

  function matching(path, pathName, startsWith = false) {
    return (
      path.toUpperCase() === pathName?.toUpperCase() ||
      path.toUpperCase() === (pathName + "/").toUpperCase() ||
      (startsWith && path.startsWith(pathName))
    );
  }

  $: displayLinks = (() => {
    // 1. Merge
    const pluginLinks = $navLinks.map((l) => ({
      ...l,
      id: l.href,
      isPlugin: true,
      target: l.target === "_self" ? null : l.target,
    }));

    const allLinks = [...nativeLinks, ...pluginLinks];
    const sorted = orderLinksBySavedOrder(
      allLinks,
      themeSettings.navLinksOrder
    );

    // 3. Filter visibility & conditions
    return sorted.filter((link) => {
      // Check explicit toggle first
      // Note: Default for native links was traditionally TRUE if undefined.
      // Default for plugin links should also be TRUE.
      const status = themeSettings.navLinksEnableStatus?.[link.id];
      if (status === false) return false; // Explicitly disabled

      // Check custom condition (e.g. Rules agreement)
      if (typeof link.condition !== "undefined" && !link.condition)
        return false;

      // Check plugin conditions
      if (link.loginRequired && !$session.user) return false;
      if (link.permission && !hasPermission(link.permission)) return false;

      return true;
    });
  })();
</script>
