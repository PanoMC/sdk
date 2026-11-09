import { describe, expect, test } from "bun:test";

import { filterStyle, sanitizeRichHtml, styleTag } from "../html.util.js";

describe("sanitizeRichHtml", () => {
  test("keeps what the panel editor writes", () => {
    const html =
      '<h2>Title</h2><p>Hi <strong>all</strong> <em>x</em> <a href="https://panomc.com" target="_blank" rel="noopener">link</a></p>' +
      '<p><span style="color: #ff0000; font-size: 18px">red</span></p><ul><li>one</li></ul><img src="https://x.test/a.png" alt="a">';
    const out = sanitizeRichHtml(html);
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain('<a href="https://panomc.com" target="_blank" rel="noopener">link</a>');
    expect(out).toContain('style="color:#ff0000;font-size:18px"');
    expect(out).toContain('<img src="https://x.test/a.png" alt="a" />');
  });

  test("removes script, event handlers and javascript: links", () => {
    const out = sanitizeRichHtml(
      '<p>ok</p><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a><iframe src="https://e.test"></iframe><svg onload="alert(1)"></svg>',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("onload");
    expect(out).toContain("<p>ok</p>");
  });

  test("a style value cannot carry markup", () => {
    expect(sanitizeRichHtml('<span style="color: red;}</style><script>">x</span>')).not.toContain("<script");
  });

  test("a style value cannot load a url", () => {
    const out = sanitizeRichHtml('<span style="background-color: url(https://e.test/x.png); color: red">x</span>');
    expect(out).not.toContain("url(");
    expect(out).toContain("color:red");
  });

  test("filterStyle keeps the allowed declarations only", () => {
    expect(filterStyle("color: red; position: fixed; background-color: url(https://e.test); font-size: 12px")).toBe(
      "color:red;font-size:12px",
    );
    expect(filterStyle("behavior: url(x.htc)")).toBe("");
  });

  test("not a string yields an empty string", () => {
    expect(sanitizeRichHtml(null)).toBe("");
    expect(sanitizeRichHtml(undefined)).toBe("");
    expect(sanitizeRichHtml(5)).toBe("");
  });
});


describe("styleTag", () => {
  test("keeps $ patterns literal", () => {
    expect(styleTag("a::after { content: \"$' $& $` $$\" }")).toBe("<style>a::after { content: \"$' $& $` $$\" }</style>");
  });

  test("a </style inside cannot close the element", () => {
    const out = styleTag("body{} </STYLE><script>alert(1)</script>");
    expect(out.toLowerCase().indexOf("</style")).toBe(out.length - "</style>".length);
  });

  test("not a string yields an empty element", () => {
    expect(styleTag(undefined)).toBe("<style></style>");
  });
});
