import { describe, expect, test } from "bun:test";

import {
  displayValue,
  fieldErrorsFromServer,
  fieldLimits,
  hasValue,
  isEmpty,
  isValidDate,
  prepareFieldValues,
  validateValue,
  visibleFields,
} from "../ticketFields.js";

const field = (key, type, extra = {}) => ({
  key,
  label: key,
  type,
  required: false,
  placeholder: "",
  help: "",
  options: [],
  min: null,
  max: null,
  conditions: null,
  ...extra,
});

const rule = (fieldKey, op, value) => ({ field: fieldKey, op, ...(value === undefined ? {} : { value }) });
const when = (match, ...rules) => ({ conditions: { match, rules } });
const keys = (definitions, values) => visibleFields(definitions, values).map((definition) => definition.key);

const topic = field("topic", "SELECT", {
  options: [
    { value: "appeal", label: "Ban appeal" },
    { value: "bug", label: "Bug" },
  ],
});
const banId = field("ban-id", "TEXT", when("ALL", rule("topic", "EQUALS", "appeal")));
const reason = field("reason", "TEXTAREA", when("ALL", rule("ban-id", "FILLED")));
const chain = [topic, banId, reason];

describe("isEmpty", () => {
  test("absent, null, blank, [] and an unticked checkbox are empty", () => {
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty("   ")).toBe(true);
    expect(isEmpty([])).toBe(true);
    expect(isEmpty(false, "CHECKBOX")).toBe(true);
    expect(isEmpty(0, "NUMBER")).toBe(false);
    expect(isEmpty("x")).toBe(false);
    expect(isEmpty(true, "CHECKBOX")).toBe(false);
  });
});

describe("visibleFields", () => {
  test("chained conditions: A=appeal shows B, B filled shows C", () => {
    expect(keys(chain, {})).toEqual(["topic"]);
    expect(keys(chain, { topic: "bug" })).toEqual(["topic"]);
    expect(keys(chain, { topic: "appeal" })).toEqual(["topic", "ban-id"]);
    expect(keys(chain, { topic: "APPEAL " })).toEqual(["topic", "ban-id"]);
    expect(keys(chain, { topic: "appeal", "ban-id": "123" })).toEqual(["topic", "ban-id", "reason"]);
  });

  test("a rule on a hidden field reads it as empty", () => {
    // ban-id still holds a value, but it is hidden once the topic changes: reason hides too
    expect(keys(chain, { topic: "bug", "ban-id": "123" })).toEqual(["topic"]);

    const ifHiddenEmpty = field("note", "TEXT", when("ALL", rule("ban-id", "EMPTY")));
    expect(keys([topic, banId, ifHiddenEmpty], { topic: "bug", "ban-id": "123" })).toEqual(["topic", "note"]);
  });

  test("ANY needs one rule, ALL needs every rule", () => {
    const a = field("a", "TEXT");
    const b = field("b", "TEXT");
    const any = field("any", "TEXT", when("ANY", rule("a", "FILLED"), rule("b", "FILLED")));
    const all = field("all", "TEXT", when("ALL", rule("a", "FILLED"), rule("b", "FILLED")));
    const list = [a, b, any, all];

    expect(keys(list, {})).toEqual(["a", "b"]);
    expect(keys(list, { a: "x" })).toEqual(["a", "b", "any"]);
    expect(keys(list, { a: "x", b: "y" })).toEqual(["a", "b", "any", "all"]);
  });

  test("MULTISELECT EQUALS and CONTAINS test membership", () => {
    const tags = field("tags", "MULTISELECT", {
      options: [
        { value: "pvp", label: "PvP" },
        { value: "chat", label: "Chat" },
      ],
    });
    const eq = field("eq", "TEXT", when("ALL", rule("tags", "EQUALS", "pvp")));
    const has = field("has", "TEXT", when("ALL", rule("tags", "CONTAINS", "chat")));
    const not = field("not", "TEXT", when("ALL", rule("tags", "NOT_EQUALS", "pvp")));
    const list = [tags, eq, has, not];

    expect(keys(list, { tags: ["pvp"] })).toEqual(["tags", "eq"]);
    expect(keys(list, { tags: ["chat", "pvp"] })).toEqual(["tags", "eq", "has"]);
    expect(keys(list, { tags: [] })).toEqual(["tags", "not"]);
  });

  test('CHECKBOX compares "true" / "false"; an unticked box is false', () => {
    const box = field("box", "CHECKBOX");
    const on = field("on", "TEXT", when("ALL", rule("box", "EQUALS", "true")));
    const off = field("off", "TEXT", when("ALL", rule("box", "EQUALS", "false")));
    const list = [box, on, off];

    expect(keys(list, { box: true })).toEqual(["box", "on"]);
    expect(keys(list, { box: false })).toEqual(["box", "off"]);
    expect(keys(list, {})).toEqual(["box", "off"]);
  });

  test("NOT_EQUALS on an empty value is true, EQUALS is false", () => {
    const a = field("a", "TEXT");
    const ne = field("ne", "TEXT", when("ALL", rule("a", "NOT_EQUALS", "x")));
    const eq = field("eq", "TEXT", when("ALL", rule("a", "EQUALS", "x")));

    expect(keys([a, ne, eq], {})).toEqual(["a", "ne"]);
    expect(keys([a, ne, eq], { a: "  " })).toEqual(["a", "ne"]);
    expect(keys([a, ne, eq], { a: "X" })).toEqual(["a", "eq"]);
  });

  test("TEXT CONTAINS is a case-insensitive substring, NUMBER EQUALS compares numbers", () => {
    const text = field("text", "TEXT");
    const num = field("num", "NUMBER");
    const sub = field("sub", "TEXT", when("ALL", rule("text", "CONTAINS", "hack")));
    const five = field("five", "TEXT", when("ALL", rule("num", "EQUALS", "5")));
    const list = [text, num, sub, five];

    expect(keys(list, { text: "Someone HACKED me", num: "5.0" })).toEqual(["text", "num", "sub", "five"]);
    expect(keys(list, { text: "hello", num: 6 })).toEqual(["text", "num"]);
  });

  test("a rule on a later or unknown field counts as empty", () => {
    const first = field("first", "TEXT", when("ALL", rule("second", "FILLED")));
    const second = field("second", "TEXT");

    expect(keys([first, second], { second: "x" })).toEqual(["second"]);
    expect(keys([field("x", "TEXT", when("ALL", rule("nope", "EMPTY")))], {})).toEqual(["x"]);
  });

  test("no definitions shows nothing", () => {
    expect(visibleFields(undefined, {})).toEqual([]);
    expect(visibleFields([], undefined)).toEqual([]);
  });
});

describe("validateValue", () => {
  test("required is enforced on empty values; a required checkbox must be ticked", () => {
    expect(validateValue(field("a", "TEXT", { required: true }), " ")).toBe("REQUIRED");
    expect(validateValue(field("a", "TEXT"), "")).toBeNull();
    expect(validateValue(field("c", "CHECKBOX", { required: true }), false)).toBe("REQUIRED");
    expect(validateValue(field("c", "CHECKBOX", { required: true }), true)).toBeNull();
  });

  test("number bounds, decimals and numeric strings", () => {
    const number = field("n", "NUMBER", { min: 1, max: 10.5 });

    expect(validateValue(number, 1)).toBeNull();
    expect(validateValue(number, "10.5")).toBeNull();
    expect(validateValue(number, 0.99)).toBe("OUT_OF_RANGE");
    expect(validateValue(number, 11)).toBe("OUT_OF_RANGE");
    expect(validateValue(number, "abc")).toBe("INVALID");
    expect(validateValue(field("n", "NUMBER", { min: 0 }), 999999)).toBeNull();
  });

  test("text length bounds and the default maximum", () => {
    const text = field("t", "TEXT", { min: 3, max: 5 });

    expect(validateValue(text, " ab ")).toBe("TOO_SHORT");
    expect(validateValue(text, "abcd")).toBeNull();
    expect(validateValue(text, "abcdef")).toBe("TOO_LONG");
    expect(validateValue(field("t", "TEXT"), "x".repeat(201))).toBe("TOO_LONG");
    expect(validateValue(field("t", "TEXTAREA"), "x".repeat(2000))).toBeNull();
    expect(fieldLimits(field("t", "TEXT", { max: 9999 })).max).toBe(500);
  });

  test("dates must be real days", () => {
    const date = field("d", "DATE");

    expect(validateValue(date, "2026-02-28")).toBeNull();
    expect(validateValue(date, "2026-02-30")).toBe("INVALID");
    expect(validateValue(date, "2024-02-29")).toBeNull();
    expect(validateValue(date, "2026-13-01")).toBe("INVALID");
    expect(validateValue(date, "26-1-1")).toBe("INVALID");
    expect(isValidDate("2025-02-29")).toBe(false);
  });

  test("email and url", () => {
    const email = field("e", "EMAIL");
    const url = field("u", "URL");

    expect(validateValue(email, " a@b.co ")).toBeNull();
    expect(validateValue(email, "a@b")).toBe("INVALID");
    expect(validateValue(email, "a b@c.de")).toBe("INVALID");
    expect(validateValue(email, `${"a".repeat(250)}@b.co`)).toBe("TOO_LONG");
    expect(validateValue(url, "https://example.com/x")).toBeNull();
    expect(validateValue(url, "http://example.com")).toBeNull();
    expect(validateValue(url, "ftp://example.com")).toBe("INVALID");
    expect(validateValue(url, "javascript:alert(1)")).toBe("INVALID");
    expect(validateValue(url, "example.com")).toBe("INVALID");
    expect(validateValue(url, `https://e.com/${"x".repeat(500)}`)).toBe("TOO_LONG");
  });

  test("select and multiselect options", () => {
    expect(validateValue(topic, "appeal")).toBeNull();
    expect(validateValue(topic, "other")).toBe("UNKNOWN_OPTION");

    const multi = field("m", "MULTISELECT", { options: topic.options });
    expect(validateValue(multi, ["appeal", "bug"])).toBeNull();
    expect(validateValue(multi, ["appeal", "appeal"])).toBe("INVALID");
    expect(validateValue(multi, ["nope"])).toBe("UNKNOWN_OPTION");
  });
});

describe("prepareFieldValues", () => {
  test("sends only visible, non-empty values, trimmed; hidden fields are not checked", () => {
    const required = field("must", "TEXT", { required: true, ...when("ALL", rule("topic", "EQUALS", "bug")) });
    const count = field("count", "NUMBER");
    const result = prepareFieldValues([topic, banId, required, count], {
      topic: "appeal",
      "ban-id": "  42 ",
      must: "",
      count: " 7 ",
      unknown: "x",
    });

    expect(result).toEqual({ fields: { topic: "appeal", "ban-id": "42", count: 7 }, errors: {}, valid: true });
  });

  test("reports the errors of visible fields", () => {
    const result = prepareFieldValues([topic, field("must", "TEXT", { required: true })], { topic: "x" });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({ topic: "UNKNOWN_OPTION", must: "REQUIRED" });
  });
});

describe("server errors and display", () => {
  test("fieldErrorsFromServer strips the fields. prefix", () => {
    expect(fieldErrorsFromServer({ "fields.ban-id": "REQUIRED", other: "X" })).toEqual({ "ban-id": "REQUIRED" });
    expect(fieldErrorsFromServer(undefined)).toEqual({});
  });

  test("displayValue links only http(s) and e-mail, localises yes/no and dates", () => {
    expect(displayValue({ type: "URL", value: "https://a.co" })).toEqual({ text: "https://a.co", href: "https://a.co" });
    expect(displayValue({ type: "URL", value: "javascript:x" }).href).toBeNull();
    expect(displayValue({ type: "EMAIL", value: "a@b.co" }).href).toBe("mailto:a@b.co");
    expect(displayValue({ type: "CHECKBOX", value: true }, { yes: "Evet", no: "Hayır" }).text).toBe("Evet");
    expect(displayValue({ type: "DATE", value: "2026-03-04" }, { locale: "en-US" }).text).toBe("Mar 4, 2026");
    expect(
      displayValue({ type: "MULTISELECT", value: ["appeal", "bug"], display: "", options: topic.options }).text,
    ).toBe("Ban appeal, Bug");
    expect(displayValue({ type: "SELECT", value: "appeal", display: "Ban appeal" }).text).toBe("Ban appeal");
    expect(hasValue({ type: "TEXT", value: null })).toBe(false);
    expect(hasValue({ type: "CHECKBOX", value: false })).toBe(false);
  });
});
