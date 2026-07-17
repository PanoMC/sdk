/** Strips all Unicode whitespace from login/registration identifier fields. */
export function stripIdentifierWhitespace(value) {
  return typeof value === "string" ? value.replace(/\s/g, "") : "";
}
