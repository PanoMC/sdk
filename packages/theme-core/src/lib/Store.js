import { writable } from "svelte/store";

import { sendLogout } from "$pano/lib/services/auth.js";
import { goto } from "$app/navigation";
import { redirect } from "@sveltejs/kit";
import { buildLoginUrl, returnToFromUrl } from "$pano/lib/returnTo.util.js";
import { showSuccess as showSuccessToast } from "$pano/lib/components/ToastContainer.svelte";

export const notificationsCount = writable(0);
export const quickNotifications = writable([]);

export const initialized = writable(false);
export const avatarVersion = writable('');

export async function logout(session) {
  sendLogout().then(async () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('pano_demo_bubble_shown');
    }

    if (session) {
      session.update((data) => {
        data.user = null;
        data.csrfToken = null;
        return data;
      });
    }

    await showSuccessToast("toasts.session-logged-out-successful");
    await goto("/");
  });
}

/**
 * Sends a guest to the login page. Pass the load event to come back to the page after login
 * (`/login?redirect=<path + query>`); a string target keeps the old fixed-redirect behaviour.
 */
export function requireLogin(session, target = "/login") {
  if (!session.user) {
    if (target && typeof target === "object" && target.url) {
      throw redirect(302, buildLoginUrl(target.url.pathname + target.url.search));
    }

    throw redirect(302, target);
  }
}

/**
 * Sends a logged-in visitor away from an auth page: back to `?redirect=` when it is a safe
 * site-relative target, else `/`.
 */
export function requireNotLogin(session, event) {
  if (session.user) {
    throw redirect(302, returnToFromUrl(event?.url));
  }
}
