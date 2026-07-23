<style>
  .no-caret::after {
    display: none !important;
  }
</style>

<!-- Footer -->
<footer class="border-top bg-gray bg-opacity-10 py-5">
  <div class="container py-lg-5 position-relative z-1">
    <div class="row justify-content-center align-items-center g-3">
      <div
        class="col-lg-4 d-flex justify-content-center align-items-center order-lg-first order-md-2 order-last">
        <ul
          class="nav nav-pills justify-content-lg-start justify-content-center small flex-wrap">
          {#each visibleLinks as link (link.id)}
            <li class="nav-item">
              <a
                class="nav-link rounded-pill small"
                href={link.href}
                target={link.target}
                title={link.text && link.text.includes(".")
                  ? $_(link.text)
                  : link.text}>
                {link.text && link.text.includes(".")
                  ? $_(link.text)
                  : link.text}
              </a>
            </li>
          {/each}

          {#if moreLinks.length > 0}
            <li class="nav-item dropup">
              <button
                class="nav-link rounded-pill small dropdown-toggle no-caret"
                data-bs-toggle="dropdown"
                type="button"
                aria-label={$_("buttons.toggle")}
                aria-expanded="false"
                on:pointerdown|preventDefault
                on:mousedown|preventDefault>
                <i class="fa-solid fa-ellipsis"></i>
              </button>
              <ul class="dropdown-menu dropdown-menu-end">
                {#each moreLinksInMenuOrder as link (link.id)}
                  <li>
                    <a
                      class="dropdown-item small"
                      href={link.href}
                      target={link.target}>
                      {link.text && link.text.includes(".")
                        ? $_(link.text)
                        : link.text}
                    </a>
                  </li>
                {/each}
              </ul>
            </li>
          {/if}
        </ul>
      </div>
      <div class="col-lg-4 col-sm-8">
        <div class="text-center vstack align-items-center gap-3">
          {#if themeSettings.footerLogoEnabled ?? true}
            <a href="/" class="d-inline-block">
              <img
                class="d-block mx-auto"
                width="128"
                height="auto"
                alt={$_("components.header.alt")}
                src="/api/websiteLogo?hash={$session.siteInfo.websiteLogoHash}" />
            </a>
          {/if}
          {#if themeSettings.footerTitleEnabled ?? true}
            <h5>{themeSettings.footerTitle || $session.siteInfo.websiteName}</h5>
          {/if}
          {#if themeSettings.footerContentEnabled ?? true}
            <small class="text-center">
              {themeSettings.footerContent || $session.siteInfo.websiteDescription}
            </small>
          {/if}
        </div>
      </div>
      <div class="col-lg-4 d-flex justify-content-center align-items-center">
        <button
          type="button"
          class="badge fs-6 {ipBadgeClass} border-0"
          on:click={onCopyIpClick}
          aria-label={$session.siteInfo.ipAddress}
          use:tooltip={[
            isIpCopied ? $_("sidebars.home.copied") : $_("sidebars.home.copy"),
            { placement: "bottom", hideOnClick: false },
          ]}>
          {$session.siteInfo.ipAddress}
        </button>
      </div>
      <div class="w-100"></div>
      <div class="col order-last">
        <div class="text-center vstack align-items-center mt-5">
          <a
            href={PANO_WEBSITE_URL}
            target="_blank"
            rel="noreferrer"
            class="d-inline-flex align-items-center justify-content-center bg-primary rounded-3 mb-2"
            style="width: 32px; height: 32px;"
            title="Pano">
            <img src="/assets/img/logo.svg" width="20" height="20" alt="Pano" />
          </a>
          <small>
            {@html $_("footer.been-created-with", {
              values: {
                pano: `<a href="${PANO_WEBSITE_URL}" class="rounded focus-ring" target="_blank" rel="noreferrer">Pano</a>`,
              },
            })}
          </small>
        </div>
      </div>
    </div>
  </div>
</footer>

<!-- Footer End -->
<script>
  import { getContext } from "svelte";
  import { _ } from "svelte-i18n";
  import copy from "copy-to-clipboard";
  import tooltip from "$pano/lib/tooltip.util";
  import { PANO_WEBSITE_URL } from "$pano/lib/variables";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";
  import { hasPermission } from "$pano/lib/auth.util.js";
  import { orderLinksBySavedOrder } from "$pano/lib/orderNavLinks.util.js";

  const session = getContext("session");
  const themeSettings = getContext("themeSettings");

  const navLinks = panoApiClient.ui.nav.site.getNavLinks();

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

  $: ipBadgeClass =
    themeSettings.themeColor === "emerald"
      ? "text-bg-success"
      : themeSettings.themeColor === "midnight"
        ? "text-bg-purple"
        : themeSettings.themeColor === "crimson"
          ? "text-bg-danger"
          : themeSettings.themeColor === "copper"
            ? "text-bg-warning"
            : "text-bg-secondary";

  $: displayLinks = (() => {
    // Check if footer links are globally disabled
    if (themeSettings.footerLinksEnabled === false) return [];

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
      themeSettings.footerLinksOrder
    );

    // 3. Filter visibility & conditions
    return sorted.filter((link) => {
      // Handle plugin links visibility setting
      if (link.isPlugin && themeSettings.footerPluginLinksEnabled === false)
        return false;

      // Check explicit footer toggle for individual link
      const status = themeSettings.footerLinksEnableStatus?.[link.id];
      if (status === false) return false;

      if (typeof link.condition !== "undefined" && !link.condition)
        return false;

      if (link.loginRequired && !$session.user) return false;
      if (link.permission && !hasPermission(link.permission)) return false;

      return true;
    });
  })();

  const MAX_INLINE_FOOTER_LINKS = 3;

  $: visibleLinks = displayLinks.slice(0, MAX_INLINE_FOOTER_LINKS);
  $: moreLinks =
    displayLinks.length > MAX_INLINE_FOOTER_LINKS
      ? displayLinks.slice(MAX_INLINE_FOOTER_LINKS)
      : [];
  // With dropup, the first DOM child is furthest from the "⋯" toggle; the last is right above it.
  // Reverse so the 4th link (first overflow) is adjacent to the toggle, matching left-to-right order.
  $: moreLinksInMenuOrder = [...moreLinks].reverse();

  /* IP Copy Logic */
  let copyClickID = 0;
  let isIpCopied = false;

  function onCopyIpClick() {
    copyClickID++;
    const id = copyClickID;
    copy($session.siteInfo.ipAddress);
    isIpCopied = true;
    setTimeout(function () {
      if (copyClickID === id) {
        isIpCopied = false;
      }
    }, 1000);
  }
</script>
