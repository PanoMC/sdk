import { describe, expect, test } from "bun:test";

import {
  localizeCategories,
  localizeCategory,
  localizeField,
  localized,
  localizedDisplay,
  localizedOption,
  localizedString,
  localizePost,
  localizePostCategory,
  localizePosts,
} from "../contentI18n.js";

const field = {
  key: "topic",
  label: "Konu",
  type: "SELECT",
  placeholder: "Seç",
  help: "",
  options: [
    { value: "appeal", label: "Ban itirazı" },
    { value: "bug", label: "Hata" },
  ],
  i18n: {
    "en-US": { label: "Topic", help: "Pick one", options: { appeal: "Ban appeal" } },
    ru: { label: "Тема", placeholder: "  " },
  },
};

describe("localized", () => {
  test("exact locale code", () => {
    expect(localized("Konu", field.i18n, "en-US", "label")).toBe("Topic");
  });

  test("language part fallback (ru-RU -> ru)", () => {
    expect(localized("Konu", field.i18n, "ru-RU", "label")).toBe("Тема");
    expect(localized("Konu", { tr: { label: "Konu TR" } }, "tr-TR", "label")).toBe("Konu TR");
  });

  test("blank or missing translation -> default", () => {
    expect(localized("Seç", field.i18n, "ru", "placeholder")).toBe("Seç");
    expect(localized("Konu", field.i18n, "de", "label")).toBe("Konu");
    expect(localized("Konu", field.i18n, "en-US", "missing")).toBe("Konu");
  });

  test("no i18n or locale (older backend) -> default", () => {
    expect(localized("Konu", undefined, "en-US", "label")).toBe("Konu");
    expect(localized("Konu", null, null, "label")).toBe("Konu");
    expect(localized(undefined, undefined, "en-US", "label")).toBe("");
  });
});

describe("localizedOption", () => {
  test("translated option, fallback to own label", () => {
    expect(localizedOption(field.options[0], field.i18n, "en-US")).toBe("Ban appeal");
    expect(localizedOption(field.options[0], field.i18n, "en")).toBe("Ban itirazı");
    expect(localizedOption(field.options[1], field.i18n, "en-US")).toBe("Hata");
    expect(localizedOption(field.options[0], undefined, "en-US")).toBe("Ban itirazı");
  });
});

describe("localizedString", () => {
  test("flat map with fallback", () => {
    const texts = { "en-US": "<p>Rules</p>", ru: "" };
    expect(localizedString("<p>Kurallar</p>", texts, "en-US")).toBe("<p>Rules</p>");
    expect(localizedString("<p>Kurallar</p>", texts, "ru")).toBe("<p>Kurallar</p>");
    expect(localizedString("<p>Kurallar</p>", undefined, "en-US")).toBe("<p>Kurallar</p>");
  });
});

describe("localizedDisplay", () => {
  const entry = (type, value, display) => ({ ...field, type, value, display });

  test("SELECT is rebuilt from the value", () => {
    expect(localizedDisplay(entry("SELECT", "appeal", "Ban itirazı"), "en-US")).toBe("Ban appeal");
  });

  test("MULTISELECT is joined with ', '", () => {
    expect(localizedDisplay(entry("MULTISELECT", ["appeal", "bug"], "Ban itirazı, Hata"), "en-US")).toBe(
      "Ban appeal, Hata",
    );
  });

  test("no translation keeps display", () => {
    expect(localizedDisplay(entry("MULTISELECT", ["appeal", "bug"], "Ban itirazı, Hata"), "de")).toBe(
      "Ban itirazı, Hata",
    );
    expect(localizedDisplay({ type: "SELECT", value: "x", display: "X" }, "en-US")).toBe("X");
    expect(localizedDisplay({ type: "SELECT", value: "x" }, "en-US")).toBe("x");
  });

  test("other types use display as is", () => {
    expect(localizedDisplay({ type: "TEXT", value: "abc", display: "abc", i18n: field.i18n }, "en-US")).toBe("abc");
  });
});

describe("localizeField / localizeCategory", () => {
  test("field texts and options are localized, i18n kept", () => {
    const result = localizeField(field, "en-US");
    expect(result.label).toBe("Topic");
    expect(result.placeholder).toBe("Seç");
    expect(result.help).toBe("Pick one");
    expect(result.options.map((option) => option.label)).toEqual(["Ban appeal", "Hata"]);
    expect(result.options.map((option) => option.value)).toEqual(["appeal", "bug"]);
    expect(result.i18n).toBe(field.i18n);
    expect(field.label).toBe("Konu");
  });

  test("localizing a localized copy starts from the source", () => {
    const english = localizeField(field, "en-US");
    expect(localizeField(english, "de").label).toBe("Konu");
  });

  test("category title, description and fields", () => {
    const category = {
      id: 1,
      title: "Destek",
      description: "Açıklama",
      fields: [field],
      i18n: { en: { title: "Support" } },
    };
    const result = localizeCategory(category, "en-US");
    expect(result.title).toBe("Support");
    expect(result.description).toBe("Açıklama");
    expect(result.fields[0].label).toBe("Topic");
    expect(localizeCategory(result, "tr").title).toBe("Destek");
  });

  test("absent data is safe", () => {
    expect(localizeCategory(null, "en")).toBe(null);
    expect(localizeCategory("-", "en")).toBe("-");
    expect(localizeCategory({ title: "-", url: "-" }, "en").title).toBe("-");
    expect(localizeCategories(undefined, "en")).toEqual([]);
    expect(localizeCategories([{ id: 2, title: "A" }], "en")[0].title).toBe("A");
  });
});

const post = {
  id: 7,
  url: "yeni-sezon",
  title: "Yeni sezon",
  text: "<p>Merhaba</p>",
  category: {
    id: 2,
    title: "Duyurular",
    description: "Haberler",
    url: "duyurular",
    i18n: { "en-US": { title: "Announcements" }, en: { description: "News" } },
  },
  i18n: { "en-US": { title: "New season", text: "<p>Hello</p>" }, ru: { title: "  " } },
};

describe("localizePost", () => {
  test("title, HTML text and category in the locale", () => {
    const copy = localizePost(post, "en-US");

    expect(copy.title).toBe("New season");
    expect(copy.text).toBe("<p>Hello</p>");
    expect(copy.category.title).toBe("Announcements");
    expect(copy.category.description).toBe("News");
    expect(copy.url).toBe("yeni-sezon");
    expect(copy.i18n).toBe(post.i18n);
    expect(post.title).toBe("Yeni sezon");
  });

  test("blank translation and unknown locale fall back to the default", () => {
    const ru = localizePost(post, "ru");

    expect(ru.title).toBe("Yeni sezon");
    expect(ru.text).toBe("<p>Merhaba</p>");
    expect(ru.category.title).toBe("Duyurular");
    expect(localizePost(post, null).title).toBe("Yeni sezon");
  });

  test("re-localizing starts from the original", () => {
    const english = localizePost(post, "en-US");
    const back = localizePost(english, "tr");

    expect(back.title).toBe("Yeni sezon");
    expect(back.text).toBe("<p>Merhaba</p>");
    expect(back.category.title).toBe("Duyurular");
    expect(localizePost(back, "en-US").title).toBe("New season");
  });

  test("without i18n: defaults, no errors", () => {
    const plain = { title: "A", text: "B", category: { title: "C", url: "c" } };
    const copy = localizePost(plain, "en-US");

    expect(copy).toEqual(plain);
    expect("i18n" in copy).toBe(false);
  });

  test("placeholders are returned as is", () => {
    expect(localizePost("-", "en-US")).toBe("-");
    expect(localizePost(null, "en-US")).toBe(null);
    expect(localizePost({ title: "A", category: "-" }, "en-US").category).toBe("-");
    expect(localizePostCategory({ title: "-", i18n: { en: { title: "X" } } }, "en").title).toBe("-");
  });

  test("a previous / next link without text keeps its shape", () => {
    expect(localizePost({ url: "a", title: "A", i18n: { en: { title: "B" } } }, "en-GB")).toEqual({
      url: "a",
      title: "B",
      i18n: { en: { title: "B" } },
    });
  });
});

describe("localizePosts", () => {
  test("maps every post; a non-array answers []", () => {
    expect(localizePosts([post], "en-US").map((item) => item.title)).toEqual(["New season"]);
    expect(localizePosts(undefined, "en-US")).toEqual([]);
  });
});
