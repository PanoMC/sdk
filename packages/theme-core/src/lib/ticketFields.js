// Custom fields of a ticket category: the pure rules shared by the create-ticket form and the ticket
// page. Visibility (section 3 of the fields contract) must match the backend and the panel exactly:
// change it in all three places together.

/** @typedef {"TEXT"|"TEXTAREA"|"NUMBER"|"EMAIL"|"URL"|"DATE"|"SELECT"|"MULTISELECT"|"CHECKBOX"} FieldType */

/**
 * @typedef {object} FieldRule
 * @property {string} field  key of an earlier field
 * @property {"EQUALS"|"NOT_EQUALS"|"CONTAINS"|"FILLED"|"EMPTY"} op
 * @property {string} [value]
 */

/**
 * @typedef {object} FieldDefinition
 * @property {string} key
 * @property {string} label
 * @property {FieldType} type
 * @property {boolean} [required]
 * @property {string} [placeholder]
 * @property {string} [help]
 * @property {{ value: string, label: string }[]} [options]
 * @property {number|null} [min]
 * @property {number|null} [max]
 * @property {{ match: "ALL"|"ANY", rules: FieldRule[] } | null} [conditions]
 */

/**
 * Svelte context key of the create-ticket form's field state (`{ values, errors }`, both writable
 * stores): the page sets it, the <TicketFieldsForm> controller reads it.
 */
export const TICKET_FIELDS_CONTEXT = "pano:ticket-fields";

/** The error codes the create call answers per field (`error.fields["fields.<key>"]`). */
export const FIELD_ERROR_CODES = ["REQUIRED", "INVALID", "TOO_SHORT", "TOO_LONG", "OUT_OF_RANGE", "UNKNOWN_OPTION"];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const HTTP_PATTERN = /^https?:\/\//i;

/** Default and hard maximum length of the text types (when `max` is null / too big). */
const TEXT_LIMITS = { TEXT: { max: 200, cap: 500 }, TEXTAREA: { max: 2000, cap: 5000 } };
const EMAIL_MAX = 254;
const URL_MAX = 500;

/**
 * Empty = absent, `null`, a blank string, `[]`, or `false` for a CHECKBOX.
 *
 * @param {unknown} value
 * @param {FieldType} [type]
 * @returns {boolean}
 */
export function isEmpty(value, type) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (value === false) return type === "CHECKBOX";
  if (typeof value === "number") return Number.isNaN(value);
  return false;
}

const lower = (value) => String(value ?? "").trim().toLowerCase();

const toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : null;
};

function equals(type, value, expected) {
  if (type === "CHECKBOX") return String(value === true) === String(expected);
  if (isEmpty(value, type)) return false;
  if (type === "MULTISELECT") return Array.isArray(value) && value.includes(expected);
  if (type === "NUMBER") {
    const a = toNumber(value);
    const b = toNumber(expected);
    return a !== null && b !== null && a === b;
  }
  return lower(value) === lower(expected);
}

function contains(type, value, expected) {
  if (type === "TEXT" || type === "TEXTAREA" || type === "EMAIL" || type === "URL") {
    if (isEmpty(value, type)) return false;
    return lower(value).includes(lower(expected));
  }
  return equals(type, value, expected);
}

/**
 * Whether one rule holds. `value` is the referenced field's value, `undefined` when that field is
 * hidden or missing (it counts as empty).
 *
 * @param {FieldRule} rule
 * @param {FieldType | undefined} type  the referenced field's type
 * @param {unknown} value
 */
export function ruleHolds(rule, type, value) {
  switch (rule.op) {
    case "FILLED":
      return !isEmpty(value, type);
    case "EMPTY":
      return isEmpty(value, type);
    case "EQUALS":
      return equals(type, value, rule.value);
    case "NOT_EQUALS":
      return !equals(type, value, rule.value);
    case "CONTAINS":
      return contains(type, value, rule.value);
    default:
      return false;
  }
}

/**
 * The fields that are shown for the given values, in order. A rule reads an earlier field; a field
 * that is not visible (or not defined) counts as empty.
 *
 * @param {FieldDefinition[] | null | undefined} definitions
 * @param {Record<string, unknown> | null | undefined} values
 * @returns {FieldDefinition[]}
 */
export function visibleFields(definitions, values) {
  const shown = new Map();
  const result = [];

  for (const definition of definitions ?? []) {
    const rules = definition.conditions?.rules ?? [];
    let visible = true;

    if (definition.conditions && rules.length > 0) {
      const check = (rule) => {
        const ref = shown.get(rule.field);
        return ruleHolds(rule, ref?.type, ref ? values?.[rule.field] : undefined);
      };

      visible = definition.conditions.match === "ANY" ? rules.some(check) : rules.every(check);
    }

    if (visible) {
      shown.set(definition.key, definition);
      result.push(definition);
    }
  }

  return result;
}

/**
 * The bounds a field's value is checked against: the number bounds for NUMBER, the length bounds for
 * the text types (with the default and hard maximum), the length limit of EMAIL / URL.
 *
 * @param {FieldDefinition} definition
 * @returns {{ min: number | null, max: number | null }}
 */
export function fieldLimits(definition) {
  const min = typeof definition.min === "number" ? definition.min : null;
  const max = typeof definition.max === "number" ? definition.max : null;
  const text = TEXT_LIMITS[definition.type];

  if (text) return { min, max: max === null ? text.max : Math.min(max, text.cap) };
  if (definition.type === "NUMBER") return { min, max };
  if (definition.type === "EMAIL") return { min: null, max: EMAIL_MAX };
  if (definition.type === "URL") return { min: null, max: URL_MAX };
  return { min: null, max: null };
}

/** Whether `YYYY-MM-DD` names a real day. */
export function isValidDate(value) {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value.trim()) : null;
  if (!match) return false;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const isHttpUrl = (value) => {
  if (!HTTP_PATTERN.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
};

/**
 * Checks one value of a visible field. Returns the error code the server would answer, or `null`.
 *
 * @param {FieldDefinition} definition
 * @param {unknown} value
 * @returns {string | null}
 */
export function validateValue(definition, value) {
  const type = definition.type;

  if (isEmpty(value, type)) return definition.required ? "REQUIRED" : null;

  const { min, max } = fieldLimits(definition);
  const options = (definition.options ?? []).map((option) => option.value);

  switch (type) {
    case "TEXT":
    case "TEXTAREA": {
      if (typeof value !== "string") return "INVALID";
      const length = value.trim().length;
      if (min !== null && length < min) return "TOO_SHORT";
      if (max !== null && length > max) return "TOO_LONG";
      return null;
    }
    case "EMAIL": {
      if (typeof value !== "string") return "INVALID";
      const text = value.trim();
      if (text.length > EMAIL_MAX) return "TOO_LONG";
      return EMAIL_PATTERN.test(text) ? null : "INVALID";
    }
    case "URL": {
      if (typeof value !== "string") return "INVALID";
      const text = value.trim();
      if (text.length > URL_MAX) return "TOO_LONG";
      return isHttpUrl(text) ? null : "INVALID";
    }
    case "DATE":
      return isValidDate(value) ? null : "INVALID";
    case "NUMBER": {
      const number = toNumber(value);
      if (number === null) return "INVALID";
      if ((min !== null && number < min) || (max !== null && number > max)) return "OUT_OF_RANGE";
      return null;
    }
    case "SELECT":
      if (typeof value !== "string") return "INVALID";
      return options.includes(value.trim()) ? null : "UNKNOWN_OPTION";
    case "MULTISELECT":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return "INVALID";
      if (new Set(value).size !== value.length) return "INVALID";
      return value.every((item) => options.includes(item)) ? null : "UNKNOWN_OPTION";
    case "CHECKBOX":
      return typeof value === "boolean" ? null : "INVALID";
    default:
      return "INVALID";
  }
}

/** The value as it is sent: strings trimmed, numbers as numbers. */
function normalize(type, value) {
  if (typeof value === "string") {
    const text = value.trim();
    return type === "NUMBER" ? Number(text) : text;
  }
  return value;
}

/**
 * Checks the visible fields and builds the `fields` object of the create call: only visible,
 * non-empty values. Hidden fields are dropped and not checked.
 *
 * @param {FieldDefinition[] | null | undefined} definitions
 * @param {Record<string, unknown> | null | undefined} values
 * @returns {{ fields: Record<string, unknown>, errors: Record<string, string>, valid: boolean }}
 */
export function prepareFieldValues(definitions, values) {
  /** @type {Record<string, unknown>} */
  const fields = {};
  /** @type {Record<string, string>} */
  const errors = {};

  for (const definition of visibleFields(definitions, values)) {
    const value = values?.[definition.key];
    const code = validateValue(definition, value);

    if (code) errors[definition.key] = code;
    else if (!isEmpty(value, definition.type)) fields[definition.key] = normalize(definition.type, value);
  }

  return { fields, errors, valid: Object.keys(errors).length === 0 };
}

/**
 * Reads the server's `error.fields` (`{ "fields.<key>": CODE }`) into `{ <key>: CODE }`.
 *
 * @param {Record<string, string> | null | undefined} errorFields
 * @returns {Record<string, string>}
 */
export function fieldErrorsFromServer(errorFields) {
  /** @type {Record<string, string>} */
  const result = {};

  for (const [path, code] of Object.entries(errorFields ?? {})) {
    if (path.startsWith("fields.")) result[path.slice("fields.".length)] = String(code);
  }

  return result;
}

/**
 * Whether a snapshot entry of `ticket.fields` holds a value worth showing.
 *
 * @param {{ type: FieldType, value: unknown }} entry
 */
export function hasValue(entry) {
  return !!entry && !isEmpty(entry.value, entry.type);
}

/**
 * The readable form of a snapshot entry (`ticket.fields[i]`): `text` to show and, for a URL with
 * http(s) or an e-mail, the `href` of a link.
 *
 * @param {{ type: FieldType, value: unknown, display?: string, options?: { value: string, label: string }[] }} entry
 * @param {{ locale?: string | null, yes?: string, no?: string }} [options]
 * @returns {{ text: string, href: string | null }}
 */
export function displayValue(entry, { locale, yes = "Yes", no = "No" } = {}) {
  const value = entry.value;
  const display = typeof entry.display === "string" && entry.display !== "" ? entry.display : null;
  const label = (optionValue) =>
    (entry.options ?? []).find((option) => option.value === optionValue)?.label ?? String(optionValue);

  switch (entry.type) {
    case "CHECKBOX":
      return { text: value === true ? yes : no, href: null };
    case "DATE": {
      if (isValidDate(value)) {
        const [year, month, day] = String(value).trim().split("-").map(Number);
        try {
          const text = new Intl.DateTimeFormat(locale || undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
            new Date(Date.UTC(year, month - 1, day)),
          );
          return { text, href: null };
        } catch {
          /* unknown locale: fall through to the raw value */
        }
      }
      return { text: display ?? String(value ?? ""), href: null };
    }
    case "URL": {
      const text = String(value ?? "").trim();
      return { text, href: isHttpUrl(text) ? text : null };
    }
    case "EMAIL": {
      const text = String(value ?? "").trim();
      return { text, href: EMAIL_PATTERN.test(text) ? `mailto:${text}` : null };
    }
    case "MULTISELECT":
      return { text: display ?? (Array.isArray(value) ? value.map(label).join(", ") : String(value ?? "")), href: null };
    case "SELECT":
      return { text: display ?? label(value), href: null };
    default:
      return { text: display ?? String(value ?? ""), href: null };
  }
}
