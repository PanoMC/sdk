import { describe, expect, test } from "bun:test";

import { devBounceTarget } from "../variables.js";

const apiUrl = "http://127.0.0.1:18500/api";

describe("devBounceTarget", () => {
  test("a page on the vite port bounces to the Pano dev server", () => {
    expect(devBounceTarget({ apiUrl, currentHref: "http://127.0.0.1:18502/support?a=1#x" })).toBe("http://127.0.0.1:18500/support?a=1#x");
  });

  test("the base path is added when the page lacks it", () => {
    expect(devBounceTarget({ apiUrl, currentHref: "http://localhost:3001/users", basePath: "/panel" })).toBe("http://127.0.0.1:18500/panel/users");
  });

  test("a page already on the API port stays", () => {
    expect(devBounceTarget({ apiUrl, currentHref: "http://127.0.0.1:18500/" })).toBeNull();
  });

  test("another host stays (LAN, tunnel)", () => {
    expect(devBounceTarget({ apiUrl, currentHref: "https://dev.example.com/" })).toBeNull();
  });

  test("the view catalogue stays on the vite port: Pano serves the built theme, where it is a 404", () => {
    expect(devBounceTarget({ apiUrl, currentHref: "http://127.0.0.1:18502/__pano/views/market/ProductCard?bare=1" })).toBeNull();
    expect(devBounceTarget({ apiUrl, currentHref: "http://127.0.0.1:18502/__pano/views" })).toBeNull();
  });
});
