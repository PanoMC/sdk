<!--
  Default markup of the engine's <HomeSidebar> (registry name "HomeSidebar", contract 1): the cards of the
  home page sidebar. The controller (components/sidebars/HomeSidebar.svelte) owns the data, the item list
  and the copy-to-clipboard state.

  Props:
    side                      "left" | "right" - which side of the content the column sits on
    items                     store of { id, component, props } - the sidebar items, plugin items included;
                              unknown ids are rendered with <ViewComponent> (the place plugins inject)
    data                      store of the home sidebar data: { mainServer, serverGameVersion, ipAddress, lastRegisteredUsers }
    themeSettings             object - the active theme's settings
    avatarVersion             store - cache buster of the avatar URLs
    serverOnline              boolean - the main server answers
    isCommandTextCopied       boolean - the address was copied a moment ago
    onCopyCommandTextClick    function() - copies the address
    playCardIpText            string - the address shown on the play card
    playCardIpLength          string - its length, for the no-JS size estimate
    playCardBgImage           string - background image URL of the play card ("" for none)
    playCardOpacity           number - opacity of that image
    playCardBgStyle           string - CSS of the overlay
    playCardBorderColor       string - Bootstrap border class of the play card
    playCardHeaderClass       string - Bootstrap background class of the style-1 header
    playCardIpColor           string - Bootstrap link class of the style-2 address
    playCardBtnColor          string - Bootstrap button colour of the style-1 address
    showPlayCardStatusBadge   boolean - show the online / offline badge
    showPlayCardPlayerCount   boolean - show the player count
    showPlayCardVersionInfo   boolean - show the game version
-->
<Sidebar side={side}>
  <div class="vstack gap-3">
    {#each $items as item (item.id)}
      {#if item.id === "play-button"}
        {#if (themeSettings.playCardStyle || "style-2") === "style-2"}
          <!-- Style 2: Modern (Faded) -->
          <div class="card position-relative overflow-hidden square-card-desktop">
            <div
              class="pano-home-sidebar__body card-body position-relative z-1 rounded overflow-hidden border border-2 {playCardBorderColor}">
              <!-- Background Image -->
              <div
                class="position-absolute top-0 start-0 w-100 h-100"
                style="background-image: url({playCardBgImage}); background-size: cover; background-position: {themeSettings.headerBgImagePosition ||
                  'center'}; opacity: {playCardOpacity}; z-index: -2;">
              </div>
              <!-- Overlay (Solid or Gradient) -->
              <div
                class="position-absolute top-0 start-0 w-100 h-100"
                style="{playCardBgStyle} z-index: -1;">
              </div>
              <ul
                class="pano-home-sidebar__list list-group list-group-flush text-center bg-transparent position-relative z-1">
                <li class="pano-home-sidebar__item list-group-item border-0 py-2 bg-transparent">
                  <button
                    class="pano-home-sidebar__action btn btn-link {playCardIpColor} border-0 shadow-none text-decoration-none w-100 focus-ring play-card-ip"
                    style="--ip-len: {playCardIpLength}; --ip-max: 28px;"
                    type="button"
                    on:click={onCopyCommandTextClick}
                    use:tooltip={[
                      isCommandTextCopied
                        ? $_("sidebars.home.copied")
                        : $_("sidebars.home.copy"),
                      { placement: "top", hideOnClick: false },
                    ]}>
                    <b class="d-block" bind:this={ipEl}>{playCardIpText}</b>
                  </button>
                </li>
                {#if showPlayCardStatusBadge}
                  <li class="pano-home-sidebar__online list-group-item border-0 py-2 bg-transparent">
                    {#if serverOnline}
                      <span class="pano-home-sidebar__badge badge text-bg-success"
                        >{$_("sidebars.home.online")}</span>
                    {:else}
                      <span class="pano-home-sidebar__offline badge text-bg-danger rounded-pill"
                        >{$_("sidebars.home.offline")}</span>
                    {/if}
                  </li>
                {/if}
                {#if showPlayCardPlayerCount}
                  <li class="pano-home-sidebar__playing list-group-item border-0 py-2 bg-transparent">
                    {$_("sidebars.home.playing", {
                      values: {
                        playerCount: $data.mainServer?.playerCount || 0,
                        maxPlayerCount: $data.mainServer?.maxPlayerCount || 0,
                      },
                    })}
                  </li>
                {/if}
                {#if showPlayCardVersionInfo}
                  <li class="pano-home-sidebar__item-2 list-group-item border-0 py-2 bg-transparent">
                    {$data.serverGameVersion}
                  </li>
                {/if}
              </ul>
            </div>
          </div>
        {:else}
          <!-- Style 1: Default -->
          <div class="card border-0 square-card-desktop">
            <div
              class="pano-home-sidebar__header card-header {playCardHeaderClass} p-0 rounded-top border-bottom border-5 {playCardBorderColor}">
              <button
                class="pano-home-sidebar__copied btn btn-{playCardBtnColor} border-0 shadow-none text-decoration-none w-100 focus-ring py-2 play-card-ip"
                style="--ip-len: {playCardIpLength}; --ip-max: 24px;"
                type="button"
                on:click={onCopyCommandTextClick}
                use:tooltip={[
                  isCommandTextCopied
                    ? $_("sidebars.home.copied")
                    : $_("sidebars.home.copy"),
                  { placement: "top", hideOnClick: false },
                ]}>
                <b class="d-block" bind:this={ipEl}>{playCardIpText}</b>
              </button>
            </div>
            <div
              class="pano-home-sidebar__body-2 card-body position-relative z-1 overflow-hidden border border-2 {playCardBorderColor} border-top-0 rounded-bottom">
              <!-- Background Image -->
              <div
                class="position-absolute top-0 start-0 w-100 h-100"
                style="background-image: url({playCardBgImage}); background-size: cover; background-position: {themeSettings.headerBgImagePosition ||
                  'center'}; opacity: {playCardOpacity}; z-index: -2;">
              </div>
              <!-- Overlay (Solid or Gradient) -->
              <div
                class="position-absolute top-0 start-0 w-100 h-100"
                style="{playCardBgStyle} z-index: -1;">
              </div>
              <ul
                class="pano-home-sidebar__list-2 list-group list-group-flush text-center bg-transparent position-relative z-1">
                {#if showPlayCardStatusBadge}
                  <li class="pano-home-sidebar__item-3 list-group-item border-0 py-2 bg-transparent">
                    {#if serverOnline}
                      <span class="pano-home-sidebar__badge-2 badge text-bg-success"
                        >{$_("sidebars.home.online")}</span>
                    {:else}
                      <span class="pano-home-sidebar__badge-3 badge text-bg-danger rounded-pill"
                        >{$_("sidebars.home.offline")}</span>
                    {/if}
                  </li>
                {/if}
                {#if showPlayCardPlayerCount}
                  <li class="pano-home-sidebar__item-4 list-group-item border-0 py-2 bg-transparent">
                    {$_("sidebars.home.playing", {
                      values: {
                        playerCount: $data.mainServer?.playerCount || 0,
                        maxPlayerCount: $data.mainServer?.maxPlayerCount || 0,
                      },
                    })}
                  </li>
                {/if}
                {#if showPlayCardVersionInfo}
                  <li class="pano-home-sidebar__item-5 list-group-item border-0 py-2 bg-transparent">
                    {$data.serverGameVersion}
                  </li>
                {/if}
              </ul>
            </div>
          </div>
        {/if}
      {:else if item.id === "server-info"}
        <!-- Merged into play-button -->
      {:else if item.id === "last-registrants"}
        <!-- Last Registrants Snippet -->
        <div
          class="card position-relative overflow-hidden mb-lg-0 mb-3 square-card-desktop"
          hidden={typeof themeSettings.sidebarCarts?.lastRegistrants ===
          "undefined"
            ? false
            : !themeSettings.sidebarCarts.lastRegistrants}>
          <CardHeader headerClasses="bg-transparent">
            <div slot="left">
              {$_("sidebars.home.last-registrants")}
            </div>
          </CardHeader>
          <div class="pano-home-sidebar__body-3 card-body pt-3 d-flex flex-column justify-content-start">
            <div class="row g-3 justify-content-evenly align-items-start align-content-start">
              {#each $data.lastRegisteredUsers || [] as player, index (player)}
                <div class="col-auto">
                  <a
                    href={route(`/player/${player.username}`)}
                    class="d-inline-block rounded focus-ring">
                    <img
                      alt={player.username}
                      class="pano-home-sidebar__image rounded"
                      class:border={player.lastActivityTime > Date.now() - 300000 || player.inGame}
                      class:border-2={player.lastActivityTime > Date.now() - 300000 || player.inGame}
                      class:border-success={player.lastActivityTime > Date.now() - 300000 || player.inGame}
                      src="/api/v1/profile/picture/{player.username}?{$avatarVersion}"
                      use:tooltip={[player.username, { placement: "bottom" }]}
                      width="48"
                      height="48" />
                  </a>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {:else}
        <!-- External Component -->
        <ViewComponent
          component={item.component}
          data={$data}
          {...item.props} />
      {/if}
    {/each}
  </div>
</Sidebar>

<script>
  import { onMount } from "svelte";
  import { _ } from "svelte-i18n";
  import tooltip from "$pano/lib/tooltip.util";
  import { route } from "$pano/registry/routes.js";
  import Sidebar from "$pano/lib/components/Sidebar.svelte";
  import CardHeader from "$pano/lib/components/CardHeader.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  export let side;
  export let items;
  export let data;
  export let themeSettings;
  export let avatarVersion;
  export let serverOnline;
  export let isCommandTextCopied;
  export let onCopyCommandTextClick;
  export let playCardIpText;
  export let playCardIpLength;
  export let playCardBgImage;
  export let playCardOpacity;
  export let playCardBgStyle;
  export let playCardBorderColor;
  export let playCardHeaderClass;
  export let playCardIpColor;
  export let playCardBtnColor;
  export let showPlayCardStatusBadge;
  export let showPlayCardPlayerCount;
  export let showPlayCardVersionInfo;

  /* Address fit — see the stylesheet for why the CSS alone is not enough.
     Measuring beats guessing at per-character width: reset to the maximum,
     compare what the text wants against what the button gives it, and scale by
     that ratio. Runs on mount, whenever the address changes, once webfonts have
     settled (metrics shift under the fallback face), and on resize. */
  const IP_MIN_PX = 13.6; // 0.85rem — matches the clamp floor

  let ipEl;

  function fitIpText() {
    const el = ipEl;
    if (!el) return;

    const max = parseFloat(getComputedStyle(el).getPropertyValue("--ip-max")) || 28;

    el.style.whiteSpace = "";
    el.style.fontSize = `${max}px`;

    const available = el.clientWidth;
    if (!available) return;

    // Two passes: scaling by the first ratio overshoots slightly because
    // letter-spacing does not scale with the font, so re-measure and correct.
    let size = max;
    for (let pass = 0; pass < 2 && el.scrollWidth > available; pass++) {
      size = Math.max(IP_MIN_PX, (size * available) / el.scrollWidth);
      el.style.fontSize = `${size}px`;
    }

    // An address long enough to hit the legibility floor wraps onto a second
    // line — still the whole address, which cutting it off would not be.
    el.style.whiteSpace = el.scrollWidth > available ? "normal" : "";
  }

  // Re-fit when the address changes; ipEl is undefined until mounted and on the
  // server, so this is a no-op there.
  $: playCardIpText, ipEl && fitIpText();

  onMount(() => {
    fitIpText();

    const observer = new ResizeObserver(fitIpText);
    if (ipEl?.parentElement) observer.observe(ipEl.parentElement);

    document.fonts?.ready.then(fitIpText).catch(() => {});

    return () => observer.disconnect();
  });
</script>

<style>
  /* The server address is site-supplied and routinely longer than a stock
     "play.example.com", so the old fixed .fs-3 overflowed the card and got cut
     off by .text-truncate — an ellipsised address is worse than useless, since
     the whole point of the card is that you can read and copy it. It now
     shrinks to fit instead.

     This rule is the server-rendered / no-JS baseline: the button is a size
     container, so 100cqi is exactly the width the address has to live in, and
     0.72em is a deliberately pessimistic per-character advance — themes ship
     very different faces (a wide serif costs far more per character than a
     narrow sans), so this errs small rather than risk clipping. fitIpText()
     then measures the real text on mount and hands back whatever headroom the
     estimate gave away, which is why --ip-max is in px: it is read from here. */
  .play-card-ip {
    container-type: inline-size;
  }

  .play-card-ip b {
    font-size: clamp(
      0.85rem,
      calc(100cqi / (var(--ip-len, 16) * 0.72)),
      var(--ip-max, 28px)
    );
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    /* inert while nowrap holds; it only matters once fitIpText() lets an
       over-long address wrap, and an address has no spaces to break at. */
    overflow-wrap: anywhere;
  }

  @media (min-width: 992px) {
    .square-card-desktop {
      aspect-ratio: 1 / 1;
      display: flex;
      flex-direction: column;
    }

    .square-card-desktop :global(.card-body) {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
  }
</style>
