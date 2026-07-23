<svelte:head>
  {@html `<style>;</style>`.replace(";", styles)}
</svelte:head>

<!-- Header -->
<div class="hero" class:container={headerWidthOption !== "FULL_SIZE"}>
  <div
    class="hero-content position-relative p-0"
    class:bg-transparent={!effectiveHeaderBgColor}
    id="header"
    style="background-position: center; height: {themeSettings.headerHeight || '256'}px;">
    <a href="/">
      <div
        class="position-absolute {logoPositionClasses} px-3"
        style="padding-top: 80px; padding-bottom: 40px;"
        class:d-none={themeSettings.logoVisibility === false}>
        <img
          alt={$_("components.header.alt")}
          class={logoAnimationClass}
          src="/api/websiteLogo?hash={$session.siteInfo.websiteLogoHash}"
          style="object-fit: contain; width: {themeSettings.logoWidth || '256'}px; height: {themeSettings.logoHeight ? themeSettings.logoHeight + 'px' : 'auto'}; max-width: 100%;"
          title={$session.siteInfo.websiteName} />
      </div>
    </a>
  </div>
</div>

<!-- Header End -->

<script>
  import { getContext } from "svelte";
  import { _ } from "svelte-i18n";

  const session = getContext("session");
  const themeSettings = getContext("themeSettings");

  const headerDefaults = {
    dark: "",
    light: "",
    copper: "#b87333",
    emerald: "#10b981",
    midnight: "#8b5cf6",
    crimson: "#ef4444",
  };

  $: effectiveHeaderBgColor =
    themeSettings.headerBgColor ||
    headerDefaults[themeSettings.themeColor || "dark"];

  $: logoPosition = themeSettings.logoPosition
    ? themeSettings.logoPosition
    : "CENTER";
  $: logoPositionClasses = getLogoPositionClasses(logoPosition);

  $: logoAnimation = themeSettings.logoAnimation || "off";
  $: logoAnimationClass = getLogoAnimationClass(logoAnimation);

  $: headerWidthOption = themeSettings.headerWidthOption || "FULL_SIZE";

  function getLogoAnimationClass(animation) {
    if (animation === "zoom") return "logo-animation-zoom";
    if (animation === "floating") return "logo-animation-floating";
    return "";
  }

  function getLogoPositionClasses(logoPosition) {
    if (logoPosition === "TOP_START") {
      return "top-0 start-0";
    } else if (logoPosition === "TOP") {
      return "top-0 start-50 translate-middle-x";
    } else if (logoPosition === "TOP_END") {
      return "top-0 end-0";
    } else if (logoPosition === "CENTER_START") {
      return "top-50 start-0 translate-middle-y";
    } else if (logoPosition === "CENTER") {
      return "top-50 start-50 translate-middle";
    } else if (logoPosition === "CENTER_END") {
      return "top-50 end-0 translate-middle-y";
    } else if (logoPosition === "BOTTOM_START") {
      return "bottom-0 start-0 ";
    } else if (logoPosition === "BOTTOM") {
      return "bottom-0 start-50 translate-middle-x";
    } else if (logoPosition === "BOTTOM_END") {
      return "bottom-0 end-0";
    }

    return "top-50 start-50 translate-middle";
  }

  const defaultHeaderBg =
    typeof themeSettings.defaultHeaderBg === "undefined"
      ? true
      : themeSettings.defaultHeaderBg;

  const styles = `
    .hero::before {
      ${effectiveHeaderBgColor ? `background-color: ${effectiveHeaderBgColor};` : ""}
      background-image: url(${defaultHeaderBg ? "/assets/img/default-header-bg.png" : themeSettings.files?.headerBackgroundImage ? "/api/theme/file/" + themeSettings.files?.headerBackgroundImage : ""}) !important;
      ${themeSettings.headerBgImagePosition ? `background-position: ${themeSettings.headerBgImagePosition} !important;` : ""}
      ${themeSettings.headerBgImageRepeat ? `background-repeat: ${themeSettings.headerBgImageRepeat} !important;` : ""}
      background-size: ${themeSettings.headerBgImageSize || "cover"} !important;
    }

    .logo-animation-zoom {
      animation: logo-zoom 5s ease-in-out infinite;
    }
    
    .logo-animation-floating {
      animation: logo-floating 3s ease-in-out infinite;
    }

    @keyframes logo-zoom {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }

    @keyframes logo-floating {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-20px); }
    }
  `;
</script>
