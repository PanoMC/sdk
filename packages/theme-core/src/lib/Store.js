import { writable } from "svelte/store";

import { sendLogout } from "$pano/lib/services/auth.js";
import { goto } from "$app/navigation";
import { redirect } from "@sveltejs/kit";
import { show as showToast } from "$pano/lib/components/ToastContainer.svelte";

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

    await showToast("toasts.session-logged-out-successful");
    await goto("/");
  });
}

export function requireLogin(session, goto = "/login") {
  if (!session.user) {
    throw redirect(302, goto);
  }
}

export function requireNotLogin(session) {
  if (session.user) {
    throw redirect(302, "/");
  }
}
