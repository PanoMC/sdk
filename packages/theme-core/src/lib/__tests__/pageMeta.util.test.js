import { describe, expect, test } from "bun:test";
import { normalizePageMeta } from "../pageMeta.util.js";

const SITE = {
  websiteName: "My Server",
  websiteDescription: "The site-wide description",
  websiteUrl: "https://pano.example/",
};
const URL_ = new URL("https://127.0.0.1:3000/store/product?x=1");

const run = (meta, extra = {}) =>
  normalizePageMeta(meta, { siteInfo: SITE, url: URL_, title: "Product", ...extra });

describe("normalizePageMeta (TC-2)", () => {
  test("description: whitespace collapsed, trimmed, cut to 300", () => {
    expect(run({ description: "  a \n\t b   c  " }).description).toBe("a b c");

    const long = run({ description: "x".repeat(500) }).description;
    expect(long).toHaveLength(300);

    expect(run({ description: "w ".repeat(400) }).description.length).toBeLessThanOrEqual(300);
  });

  test("empty / non-string description falls back to the site-wide description", () => {
    for (const description of ["", "   \n ", 5, null, {}, undefined]) {
      const out = run({ description });
      expect(out.description).toBe("The site-wide description");
      expect(out.ogDescription).toBe("The site-wide description");
    }
  });

  test("relative image is made absolute with websiteUrl (no double slash)", () => {
    expect(run({ image: "/img/a.png" }).ogImage).toBe("https://pano.example/img/a.png");
  });

  test("relative image uses url.origin when websiteUrl is empty", () => {
    const out = run({ image: "/img/a.png" }, { siteInfo: { ...SITE, websiteUrl: "" } });
    expect(out.ogImage).toBe("https://127.0.0.1:3000/img/a.png");
    expect(out.twitterCard).toBe("summary_large_image");
  });

  test("a websiteUrl that is not http(s) is ignored in favour of url.origin", () => {
    const out = run({ image: "/a.png" }, { siteInfo: { ...SITE, websiteUrl: "javascript:alert(1)" } });
    expect(out.ogImage).toBe("https://127.0.0.1:3000/a.png");
  });

  test("absolute http(s) image kept; every other image is dropped", () => {
    expect(run({ image: "https://cdn.example/a.png" }).ogImage).toBe("https://cdn.example/a.png");
    expect(run({ image: "http://cdn.example/a.png" }).ogImage).toBe("http://cdn.example/a.png");

    for (const image of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//evil.example/a.png",
      "/\\evil.example/a.png",
      "relative/a.png",
      "ftp://x/a.png",
      "",
      42,
      null,
    ]) {
      const out = run({ image });
      expect(out.ogImage).toBeNull();
      expect(out.twitterCard).toBe("summary");
    }
  });

  test("imageAlt: kept with an image, cut to 200, null without an image", () => {
    expect(run({ image: "/a.png", imageAlt: "x".repeat(300) }).ogImageAlt).toHaveLength(200);
    expect(run({ image: "/a.png", imageAlt: " a  b " }).ogImageAlt).toBe("a b");
    expect(run({ image: "/a.png" }).ogImageAlt).toBeNull();
    expect(run({ imageAlt: "alt" }).ogImageAlt).toBeNull();
  });

  test("canonical: site-relative path accepted and made absolute", () => {
    const out = run({ canonical: "/store/product/42?ref=a#frag" });
    expect(out.canonical).toBe("https://pano.example/store/product/42?ref=a");
    expect(out.ogUrl).toBe(out.canonical);
  });

  test("canonical: absolute URL with the site's origin accepted", () => {
    expect(run({ canonical: "https://pano.example/store/p" }).canonical).toBe(
      "https://pano.example/store/p",
    );
  });

  test("canonical: foreign origin / unsafe values are dropped (ogUrl falls back to the page URL)", () => {
    for (const canonical of [
      "https://evil.example/store/p",
      "http://pano.example/store/p",
      "https://pano.example.evil.example/",
      "//evil.example/x",
      "/\\evil.example",
      "/.//evil.example",
      "javascript:alert(1)",
      "relative",
      "/a\nb",
      "",
      7,
    ]) {
      const out = run({ canonical });
      expect(out.canonical).toBeNull();
      expect(out.ogUrl).toBe("https://pano.example/store/product");
    }
  });

  test("auth paths are allowed as canonical (no auth-page guard)", () => {
    expect(run({ canonical: "/login" }).canonical).toBe("https://pano.example/login");
  });

  test("robots: unknown tokens removed, case folded, deduplicated, empty => null", () => {
    expect(run({ robots: "noindex, evil" }).robots).toBe("noindex");
    expect(run({ robots: "NoIndex , NOFOLLOW,noindex" }).robots).toBe("noindex, nofollow");
    expect(run({ robots: "evil, other" }).robots).toBeNull();
    expect(run({ robots: "" }).robots).toBeNull();
    expect(run({ robots: ["noindex"] }).robots).toBeNull();
    expect(run({}).robots).toBeNull();
  });

  test("type defaults to website; only website, article, product are accepted", () => {
    expect(run({}).ogType).toBe("website");
    expect(run({ type: "article" }).ogType).toBe("article");
    expect(run({ type: "product" }).ogType).toBe("product");
    expect(run({ type: "video.movie" }).ogType).toBe("website");
  });

  test("referrer: only the three policies, else null", () => {
    expect(run({ referrer: "no-referrer" }).referrer).toBe("no-referrer");
    expect(run({ referrer: "same-origin" }).referrer).toBe("same-origin");
    expect(run({ referrer: "strict-origin-when-cross-origin" }).referrer).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(run({ referrer: "unsafe-url" }).referrer).toBeNull();
    expect(run({ referrer: "origin" }).referrer).toBeNull();
    expect(run({}).referrer).toBeNull();
  });

  test("jsonLd containing </script> is serialised without a literal <", () => {
    const out = run({
      jsonLd: { "@type": "Product", name: "</script><script>alert(1)</script>", n: "a<b" },
    });

    expect(out.jsonLd).not.toContain("<");
    expect(out.jsonLd).toContain("\\u003c/script>");
    // still valid JSON that round-trips to the original value
    expect(JSON.parse(out.jsonLd).name).toBe("</script><script>alert(1)</script>");
    expect(JSON.parse(out.jsonLd).n).toBe("a<b");
  });

  test("jsonLd arrays of objects are accepted", () => {
    const out = run({ jsonLd: [{ "@type": "A" }, { "@type": "B" }] });
    expect(JSON.parse(out.jsonLd)).toEqual([{ "@type": "A" }, { "@type": "B" }]);
  });

  test("oversize jsonLd is dropped; non-object jsonLd is dropped", () => {
    expect(run({ jsonLd: { d: "x".repeat(20000) } }).jsonLd).toBeNull();

    // exactly at the limit stays (the object wrapper {"d":""} is 8 chars)
    const atLimit = run({ jsonLd: { d: "x".repeat(16384 - 8) } }).jsonLd;
    expect(atLimit).toHaveLength(16384);
    expect(run({ jsonLd: { d: "x".repeat(16384 - 7) } }).jsonLd).toBeNull();

    for (const jsonLd of ["string", 5, true, null, undefined, [], [1, 2], [{}, null]]) {
      expect(run({ jsonLd }).jsonLd).toBeNull();
    }
  });

  test("jsonLd that cannot be serialised is dropped instead of throwing", () => {
    const circular = {};
    circular.self = circular;
    expect(run({ jsonLd: circular }).jsonLd).toBeNull();
    expect(run({ jsonLd: { n: 10n } }).jsonLd).toBeNull();
  });

  test('non-object meta ("x", null, arrays) => site-wide description only', () => {
    for (const meta of ["x", null, undefined, 3, ["description"]]) {
      const out = run(meta);
      expect(out.description).toBe("The site-wide description");
      expect(out.ogDescription).toBe("The site-wide description");
      expect(out.canonical).toBeNull();
      expect(out.ogImage).toBeNull();
      expect(out.robots).toBeNull();
      expect(out.referrer).toBeNull();
      expect(out.jsonLd).toBeNull();
      expect(out.ogType).toBe("website");
    }
  });

  test("og:title defaults to the resolved title, then the site name; meta.title wins", () => {
    expect(run({}).ogTitle).toBe("Product");
    expect(run({ title: "Custom" }).ogTitle).toBe("Custom");
    expect(run({ title: "  " }).ogTitle).toBe("Product");
    expect(run({}, { title: "" }).ogTitle).toBe("My Server");
    expect(run({}, { title: undefined }).ogTitle).toBe("My Server");
  });

  test("ogUrl, siteName and twitterCard defaults", () => {
    const out = run({});
    expect(out.ogUrl).toBe("https://pano.example/store/product");
    expect(out.siteName).toBe("My Server");
    expect(out.twitterCard).toBe("summary");

    const noBase = normalizePageMeta({}, { siteInfo: {}, url: URL_, title: "T" });
    expect(noBase.ogUrl).toBe("https://127.0.0.1:3000/store/product");
    expect(noBase.siteName).toBeNull();
    expect(noBase.description).toBeNull();
  });

  test("tolerates missing context entirely", () => {
    const out = normalizePageMeta(undefined);
    expect(out.description).toBeNull();
    expect(out.ogTitle).toBeNull();
    expect(out.ogUrl).toBeNull();
    expect(out.ogType).toBe("website");
  });
});
