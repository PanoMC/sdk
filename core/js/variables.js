export let API_URL = import.meta.env.VITE_API_URL;
export const UI_URL = import.meta.env.VITE_UI_URL;
export const PANEL_URL = import.meta.env.VITE_PANEL_URL;
export const SETUP_URL = import.meta.env.VITE_SETUP_URL;
export let PANO_WEBSITE_URL = import.meta.env.VITE_PANO_WEBSITE_URL;
export let PANO_WEBSITE_API_URL = import.meta.env.VITE_PANO_WEBSITE_API_URL;
export const PRERELEASE = import.meta.env.VITE_PRERELEASE;

export const COOKIE_PREFIX = import.meta.env.VITE_COOKIE_PREFIX;

export const CSRF_TOKEN_COOKIE_NAME = 'csrf_token';
export const JWT_COOKIE_NAME = 'auth_token';

export const CSRF_HEADER = 'X-CSRF-Token';

export function checkDomainRedirection() {
  if (typeof window === 'undefined' || !API_URL || API_URL.startsWith('/')) return;

  try {
    const apiUrl = new URL(API_URL);
    const currentUrl = new URL(window.location.href);

    const isDev = import.meta.env.DEV;

    if (isDev) {
      if (
        currentUrl.hostname !== apiUrl.hostname ||
        currentUrl.port !== apiUrl.port ||
        currentUrl.protocol !== apiUrl.protocol
      ) {
        const basePath = UI_URL || PANEL_URL || SETUP_URL || '/';
        let pathname = currentUrl.pathname;

        if (basePath !== '/' && !pathname.startsWith(basePath)) {
          pathname = basePath + (pathname === '/' ? '' : pathname);
        }

        const targetUrl = new URL(pathname + currentUrl.search + currentUrl.hash, apiUrl.origin);
        window.location.href = targetUrl.toString();
      }
    } else {
      if (currentUrl.port !== apiUrl.port) {
        const targetUrl = new URL(window.location.href);
        targetUrl.port = apiUrl.port;
        window.location.href = targetUrl.toString();
      }
    }
  } catch (e) {
    console.error('Failed to check domain redirection:', e);
  }
}

export function updateApiUrl(apiUrl) {
  API_URL = apiUrl;
}

export function updatePanoWebsiteUrl(panoWebsiteUrl) {
  PANO_WEBSITE_URL = panoWebsiteUrl;
}

export function updatePanoWebsiteApiUrl(panoWebsiteApiUrl) {
  PANO_WEBSITE_API_URL = panoWebsiteApiUrl;
}
