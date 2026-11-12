<!--
  Controller of the engine's <TicketFields>: the custom field values of a ticket (its `fields` snapshot) on
  the ticket page. It keeps the entries that have a value and makes them readable (option labels, the date
  in the UI language, Yes / No, links for http(s) URLs and e-mails); the markup lives in
  views/parts/TicketFields.svelte, and a theme may replace it with the "TicketFields" entry of
  theme.config.js views (see skin-contract.json for the props).

  Props:
    fields  array | null — `ticket.fields`: [{ key, label, type, options, min, max, value, display, i18n }]
-->
<svelte:component this={getOverride("TicketFields") ?? TicketFieldsView} {entries} />

<script>
  import { _, locale } from "svelte-i18n";

  import { getOverride } from "$pano/registry/index.js";
  import { displayValue, hasValue } from "$pano/lib/ticketFields.js";
  import { localized, localizedDisplay } from "$pano/lib/contentI18n.js";
  import TicketFieldsView from "$pano/lib/views/parts/TicketFields.svelte";

  export let fields = [];

  // Labels and SELECT / MULTISELECT values in the site's current language (the entry's `i18n`).
  $: entries = (Array.isArray(fields) ? fields : []).filter(hasValue).map((entry) => {
    const readable = displayValue(entry, {
      locale: $locale,
      yes: $_("pages.ticket-detail.fields.yes"),
      no: $_("pages.ticket-detail.fields.no"),
    });

    return {
      key: entry.key,
      label: localized(entry.label, entry.i18n, $locale, "label"),
      type: entry.type,
      value: entry.value,
      ...readable,
      ...(entry.type === "SELECT" || entry.type === "MULTISELECT" ? { text: localizedDisplay(entry, $locale) } : {}),
    };
  });
</script>
