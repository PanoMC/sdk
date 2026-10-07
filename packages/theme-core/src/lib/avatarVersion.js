import { writable } from "svelte/store";

/**
 * Cache-busting suffix for profile picture URLs.
 *
 * Request-specific state must never live in module scope on the server (one
 * process serves every user), and the server render must equal the first client
 * render. So: on the server the store is read-only ('' always); on the client
 * writes made before hydration finished are held back and applied by
 * markAvatarVersionHydrated() (RootLayout onMount), so the first client render
 * also uses ''.
 */
export function createAvatarVersionStore(isBrowser = typeof window !== "undefined") {
  const store = writable("");
  let hydrated = false;
  let pending = null;

  return {
    subscribe: store.subscribe,
    set(value) {
      if (!isBrowser) return;
      if (hydrated) store.set(value);
      else pending = value;
    },
    markHydrated() {
      hydrated = true;
      if (pending !== null) {
        store.set(pending);
        pending = null;
      }
    },
  };
}

export const avatarVersion = createAvatarVersionStore();

export function markAvatarVersionHydrated() {
  avatarVersion.markHydrated();
}
