import { describe, expect, mock, test } from "bun:test";

mock.module("$app/environment", () => ({ dev: false, building: false, browser: false }));
mock.module("../../lib/services/auth.js", () => ({ getCredentialsServerSide: async () => ({}) }));

const variables = await import("../../lib/variables.js");
variables.updateApiUrl("http://127.0.0.1:18500/api");
const { createThemeHooks } = await import("../hooks-server.js");

describe("handleFetch", () => {
  test("sends backend requests with the global fetch when the site origin equals the variables.API_URL origin", async () => {
    const { handleFetch } = createThemeHooks({ internalLibsHash: "x", runtimeShimsHash: "x" });
    const origin = new URL(variables.API_URL).origin;
    const event = { url: new URL(origin + "/"), request: new Request(origin + "/") };
    const hookFetch = mock(async () => new Response("hook"));
    const realFetch = globalThis.fetch;
    const globalFetch = mock(async () => new Response("net"));
    globalThis.fetch = globalFetch;
    try {
      await handleFetch({ event, request: new Request(origin + "/api/v1/site-info"), fetch: hookFetch });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(hookFetch).not.toHaveBeenCalled();
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch.mock.calls[0][0].url).toBe(variables.API_URL.replace(/\/api\/?$/, "") + "/api/v1/site-info");
  });

  test("a server-side plugin call (/api/plugins/<id>/...) goes to the backend with the key, cookie and visitor address", async () => {
    const { handleFetch } = createThemeHooks({ internalLibsHash: "x", runtimeShimsHash: "x" });
    const site = "http://127.0.0.1:3000";
    const event = {
      url: new URL(site + "/store"),
      request: new Request(site + "/store", { headers: { cookie: "a=b", "x-forwarded-for": "203.0.113.9" } }),
      getClientAddress: () => "10.0.0.1",
    };
    const hookFetch = mock(async () => new Response("hook"));
    const realFetch = globalThis.fetch;
    const globalFetch = mock(async () => new Response("net"));
    globalThis.fetch = globalFetch;
    process.env.PANO_FRONTEND_KEY = "k-test";
    try {
      await handleFetch({ event, request: new Request(site + "/api/plugins/pano-plugin-market/store/products?x=1"), fetch: hookFetch });
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.PANO_FRONTEND_KEY;
    }
    expect(hookFetch).not.toHaveBeenCalled();
    expect(globalFetch).toHaveBeenCalledTimes(1);
    const sent = globalFetch.mock.calls[0][0];
    expect(sent.url).toBe("http://127.0.0.1:18500/api/plugins/pano-plugin-market/store/products?x=1");
    expect(sent.headers.get("x-pano-frontend-key")).toBe("k-test");
    expect(sent.headers.get("x-pano-client-ip")).toBe("203.0.113.9");
    expect(sent.headers.get("cookie")).toBe("a=b");
  });
});
