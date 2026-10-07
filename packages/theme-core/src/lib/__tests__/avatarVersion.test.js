import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { createAvatarVersionStore } from "../avatarVersion.js";

describe("avatarVersion", () => {
  test("two simulated SSR requests never share a value", () => {
    const server = createAvatarVersionStore(false);
    server.set("v=1111"); // request A (processLoad)
    expect(get(server)).toBe(""); // request B renders: nothing leaked
    server.set("v=2222");
    expect(get(server)).toBe("");
  });

  test("server output equals the first client render; value applies after hydration", () => {
    const server = createAvatarVersionStore(false);
    const client = createAvatarVersionStore(true);
    server.set("v=1");
    client.set("v=1"); // load runs before hydration
    expect(get(client)).toBe(get(server)); // first client render matches SSR
    client.markHydrated(); // RootLayout onMount
    expect(get(client)).toBe("v=1");
    client.set("v=2"); // later PluginAPI.avatar.updateVersion
    expect(get(client)).toBe("v=2");
  });
});
