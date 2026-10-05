// Pure helper for the `pageTitle` a load() may return (spec 15 section 4.4).
//
// Forms: a string (i18n key), or an object { title, titleValues, subtitle, subtitleValues, html,
// subtitleHtml, raw, hidden }. `raw` uses title / subtitle verbatim (no translation); `hidden`
// keeps the value for the document <title> only (no visible <PageTitle>).

/**
 * @param {unknown} pt the pageTitle value (null, a string or an object)
 * @param {(key: string, options?: { values?: object }) => string} translate
 * @returns {{ title: string, subtitle: string, hidden: boolean }}
 */
export function resolvePageTitle(pt, translate) {
  if (typeof pt === "string") {
    return { title: pt ? translate(pt) : "", subtitle: "", hidden: false };
  }

  if (!pt || typeof pt !== "object") return { title: "", subtitle: "", hidden: false };

  const raw = pt.raw === true;
  const resolve = (value, values) => {
    if (!value) return "";
    if (raw) return String(value);

    return translate(value, { values: values || {} });
  };

  return {
    title: resolve(pt.title, pt.titleValues),
    subtitle: resolve(pt.subtitle, pt.subtitleValues),
    hidden: pt.hidden === true,
  };
}
