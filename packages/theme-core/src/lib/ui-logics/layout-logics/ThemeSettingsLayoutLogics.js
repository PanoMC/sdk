import { onMount } from "svelte";
import { redirect } from "@sveltejs/kit";
import { writable } from "svelte/store";

import { hasPermission, Permissions } from "$pano/lib/auth.util";
import { browser } from "$app/env";

// The settings page runs in an iframe of the panel, which Pano serves from the same origin. Messages go only to
// that origin and are taken only from the parent window on it.
const panelOrigin = () => window.location.origin;

function postHeight() {
  const h = Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight
  );
  window.parent.postMessage({ type: "theme-iframe-height", height: h }, panelOrigin());
}

function postLoaded() {
  window.parent.postMessage({ type: "theme-settings-loaded" }, panelOrigin());
}

function postReady() {
  window.parent.postMessage({ type: "theme-settings-ready" }, panelOrigin());
}

// The theme settings UI runs inside an iframe in the panel, so its toasts are posted to
// the parent instead of rendered here. `variant` ('success' | 'danger') rides along so the
// panel can colour the toast — without it the panel has no way to tell an outcome from a
// failure and has to fall back to a neutral toast. A panel build that predates the field
// simply ignores it.
export function showToast(text, params = {}, toastComponent, variant = null) {
  window.parent.postMessage({ type: "show-toast", text, params, toastComponent, variant }, panelOrigin());
}

export function showSuccessToast(text, params = {}) {
  showToast(text, params, undefined, "success");
}

export function showErrorToast(text, params = {}) {
  showToast(text, params, undefined, "danger");
}

const confirmCallbacks = new Map();

/** A confirm id nobody can guess, so a message cannot fire a pending confirmation. */
function confirmId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only stylesheets of this origin are injected. */
function sameOriginHref(href) {
  try {
    return typeof href === "string" && new URL(href, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function showConfirm(title, onConfirm) {
  const id = confirmId();
  confirmCallbacks.set(id, onConfirm);
  window.parent.postMessage({ type: "show-confirm", title, id }, panelOrigin());
}

export async function processLoadServer(event) {
  const { parent } = event;
  const parentData = await parent();
  const { user, siteInfo: { themeSettings } } = parentData;

  if (!hasPermission(Permissions.MANAGE_VIEW, user || {})) {
    throw redirect(302, "/");
  }

  return { themeSettings };
}

export async function processLoad(event) {
  const { data } = event;

  if (browser) {
    if (typeof window !== "undefined" && window.top === window.self) {
      throw redirect(302, "/");
    }
  }

  return data;
}

// First remove existing global styles
const removeExistingStyles = () => {
  // Find and remove all style tags (non-scoped ones)
  const existingStyles = Array.from(document.querySelectorAll('style'));
  existingStyles.forEach(style => {
    // Keep scoped styles (those with data-svelte-h attribute)
    // Keep panel-injected CSS
    // Remove global styles
    if (!style.hasAttribute('data-svelte-h') && style.id !== 'panel-injected-css') {
      console.log('Removing existing style:', style);
      style.remove();
    }
  });

  // Also remove CSS from link tags (but keep panel-injected ones)
  const cssLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  cssLinks.forEach(link => {
    // Keep panel-injected links
    if (link.getAttribute('data-panel-injected') === 'true') {
      return;
    }
    // Remove theme-specific CSS
    if (link.href && (link.href.includes('_app') || link.href.includes('theme'))) {
      console.log('Removing CSS link:', link.href);
      link.remove();
    }
  });
};

export function init() {
  const hidden = writable(true);

  const handleMessage = function (e) {
    if (e.source !== window.parent || e.origin !== window.location.origin) return;

    if (e.data)
      console.log("Theme received message", e.data.type);

    if (e.data && e.data.type === "theme-iframe-ping") {
      postHeight();
    }

    if (e.data && e.data.type === "confirm-callback") {
      const callback = confirmCallbacks.get(e.data.id);
      if (callback) {
        callback();
        confirmCallbacks.delete(e.data.id);
      }
    }

    // Message to set data-bs-theme
    if (e.data && e.data.type === "set-bs-theme" && e.data.theme) {
      console.log("Setting data-bs-theme to:", e.data.theme);
      document.documentElement.setAttribute("data-bs-theme", e.data.theme);
    }

    // CSS inject-all message (both inline and links)
    if (e.data && e.data.type === "inject-css-all") {
      const { css } = e.data;
      const links = Array.isArray(e.data.links) ? e.data.links.filter(sameOriginHref) : [];
      console.log("Received combined CSS. Links:", links?.length, "Inline CSS length:", css?.length);

      removeExistingStyles();

      // 1. Inject Inline CSS
      if (css) {
        const style = document.createElement("style");
        style.id = "panel-injected-css";
        style.textContent = css;
        document.head.appendChild(style);
      }

      // 2. Inject CSS Links
      if (links && Array.isArray(links) && links.length > 0) {
        let loadedCount = 0;
        const totalLinks = links.length;

        links.forEach((href) => {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          link.setAttribute("data-panel-injected", "true");

          const onComplete = () => {
            loadedCount++;
            if (loadedCount === totalLinks) {
              console.log("All CSS links loaded successfully");
              hidden.set(false);
              setTimeout(() => {
                postHeight();
                postReady();
              }, 150);
            }
          };

          link.onload = onComplete;
          link.onerror = () => {
            console.warn("Failed to load CSS link:", href);
            onComplete();
          };

          document.head.appendChild(link);
        });
      } else {
        // No links to load, ready now
        hidden.set(false);
        setTimeout(() => {
          postHeight();
          postReady();
        }, 150);
      }
    }
  };

  onMount(async () => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", postLoaded);
    } else {
      // If already loaded, wait a bit and check again,
      postLoaded();
    }

    window.addEventListener("load", postHeight);
    window.addEventListener("resize", postHeight);

    // CSS inject and theme listener
    window.addEventListener("message", handleMessage);

    const ro = new ResizeObserver(postHeight);
    ro.observe(document.body);

    // hidden.set(false); // Wait for CSS injection

    // Fallback: If no CSS is received within 2 seconds, show the content anyway
    setTimeout(() => {
      hidden.update((n) => {
        if (n) {
          console.warn(
            "Theme settings CSS injection timeout - showing content anyway"
          );
          return false;
        }
        return n;
      });
    }, 2000);

    document.body.classList.remove("bg-light");

    return () => {
      window.removeEventListener("load", postHeight);
      window.removeEventListener("resize", postHeight);
      window.removeEventListener("message", handleMessage);
      ro.disconnect();
    };
  });

  return hidden;
}