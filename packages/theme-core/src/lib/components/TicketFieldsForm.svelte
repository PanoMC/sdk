<!--
  Controller of the engine's <TicketFieldsForm>: the custom fields of the chosen ticket category on the
  create-ticket page. It applies the visibility rules live and hands the visible fields to the markup in
  views/parts/TicketFieldsForm.svelte; a theme may replace that with the "TicketFieldsForm" entry of
  theme.config.js views (see skin-contract.json for the props).

  Props:
    category  object | null — the chosen category (its `fields` are the definitions, translated texts in
              their `i18n` are applied for the current language); null = none
    values    writable store — field key -> value (default: the create-ticket page's, from context)
    errors    writable store — field key -> error code (default: the create-ticket page's, from context)
-->
<svelte:component this={getOverride("TicketFieldsForm") ?? TicketFieldsFormView} fields={shown} {values} errors={$errors} />

<script>
  import { getContext } from "svelte";
  import { writable } from "svelte/store";
  import { locale } from "svelte-i18n";

  import { getOverride } from "$pano/registry/index.js";
  import { TICKET_FIELDS_CONTEXT, visibleFields } from "$pano/lib/ticketFields.js";
  import { localizeField } from "$pano/lib/contentI18n.js";
  import TicketFieldsFormView from "$pano/lib/views/parts/TicketFieldsForm.svelte";

  const state = getContext(TICKET_FIELDS_CONTEXT);

  export let category = null;
  export let values = state?.values ?? writable({});
  export let errors = state?.errors ?? writable({});

  // Another category has other fields: start it empty.
  let shownCategoryId = category?.id ?? null;

  $: if ((category?.id ?? null) !== shownCategoryId) {
    shownCategoryId = category?.id ?? null;
    values.set({});
    errors.set({});
  }

  // An edited field loses its error until the next submit.
  // (a bound input mutates the same object, so the previous values are kept as a copy)
  let lastValues = { ...($values ?? {}) };

  function clearEditedErrors(current) {
    const before = lastValues;
    lastValues = { ...(current ?? {}) };

    const edited = Object.keys($errors ?? {}).filter((key) => current?.[key] !== before[key]);

    if (edited.length > 0) {
      errors.update((existing) => {
        const next = { ...existing };
        edited.forEach((key) => delete next[key]);
        return next;
      });
    }
  }

  $: clearEditedErrors($values);

  // The markup gets label, placeholder, help and option labels in the site's current language.
  $: shown = visibleFields(category?.fields ?? [], $values).map((field) => localizeField(field, $locale));
</script>
