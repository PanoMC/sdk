<!--
  Default markup of the engine's <TicketFieldsForm> (registry name "TicketFieldsForm", contract 1): the
  inputs of a ticket category's custom fields on the create-ticket page. Renders nothing without fields.

  Props:
    fields  array — the VISIBLE field definitions, in order ({ key, label, type, required, placeholder,
            help, options: [{ value, label }], min, max }); the controller applies the conditions
    values  writable store — field key -> value; bind inputs to $values[field.key]
            (TEXT/TEXTAREA/EMAIL/URL/DATE/SELECT: string, NUMBER: number, MULTISELECT: string array,
            CHECKBOX: boolean)
    errors  object — field key -> error code (REQUIRED, INVALID, TOO_SHORT, TOO_LONG, OUT_OF_RANGE,
            UNKNOWN_OPTION), from the client checks or the server
-->
{#if fields.length > 0}
  <div class="pano-ticket-fields-form vstack gap-3">
    {#each fields as field (field.key)}
      {@const id = `ticketField-${field.key}`}
      {@const code = errors?.[field.key]}
      <div class="pano-ticket-fields-form__field">
        {#if field.type === "CHECKBOX"}
          <div class="pano-ticket-fields-form__option form-check">
            <input
              {id}
              type="checkbox"
              class="pano-ticket-fields-form__check form-check-input"
              class:is-invalid={!!code}
              bind:checked={$values[field.key]} />
            <label class="pano-ticket-fields-form__check-label form-check-label" for={id}>
              {field.label}
              {#if field.required}<span class="pano-ticket-fields-form__required text-danger">*</span>{/if}
            </label>
            {#if code}
              <div class="pano-ticket-fields-form__error invalid-feedback">{errorText(field, code)}</div>
            {/if}
          </div>
        {:else}
          {#if field.type === "MULTISELECT"}
            <div class="pano-ticket-fields-form__label form-label mb-1" id="{id}-label">
              {field.label}
              {#if field.required}<span class="pano-ticket-fields-form__required text-danger">*</span>{/if}
            </div>
          {:else}
            <label class="pano-ticket-fields-form__label form-label mb-1" for={id}>
              {field.label}
              {#if field.required}<span class="pano-ticket-fields-form__required text-danger">*</span>{/if}
            </label>
          {/if}

          {#if field.type === "TEXTAREA"}
            <textarea
              {id}
              class="pano-ticket-fields-form__input form-control"
              class:is-invalid={!!code}
              rows="3"
              placeholder={field.placeholder || ""}
              maxlength={limits(field).max}
              bind:value={$values[field.key]}></textarea>
          {:else if field.type === "NUMBER"}
            <input
              {id}
              type="number"
              step="any"
              class="pano-ticket-fields-form__input form-control"
              class:is-invalid={!!code}
              placeholder={field.placeholder || ""}
              min={field.min ?? undefined}
              max={field.max ?? undefined}
              bind:value={$values[field.key]} />
          {:else if field.type === "EMAIL"}
            <input
              {id}
              type="email"
              class="pano-ticket-fields-form__input form-control"
              class:is-invalid={!!code}
              placeholder={field.placeholder || ""}
              maxlength={limits(field).max}
              bind:value={$values[field.key]} />
          {:else if field.type === "URL"}
            <input
              {id}
              type="url"
              class="pano-ticket-fields-form__input form-control"
              class:is-invalid={!!code}
              placeholder={field.placeholder || "https://"}
              maxlength={limits(field).max}
              bind:value={$values[field.key]} />
          {:else if field.type === "DATE"}
            <input
              {id}
              type="date"
              class="pano-ticket-fields-form__input form-control"
              class:is-invalid={!!code}
              bind:value={$values[field.key]} />
          {:else if field.type === "SELECT"}
            <select
              {id}
              class="pano-ticket-fields-form__select form-select"
              class:is-invalid={!!code}
              bind:value={$values[field.key]}>
              <option value="">{$_("pages.create-ticket.fields.choose")}</option>
              {#each field.options ?? [] as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          {:else if field.type === "MULTISELECT"}
            <div class="pano-ticket-fields-form__options vstack gap-1" role="group" aria-labelledby="{id}-label">
              {#each field.options ?? [] as option (option.value)}
                <div class="pano-ticket-fields-form__option form-check">
                  <input
                    id="{id}-{option.value}"
                    type="checkbox"
                    class="pano-ticket-fields-form__check form-check-input"
                    class:is-invalid={!!code}
                    checked={($values[field.key] ?? []).includes(option.value)}
                    on:change={(event) => toggle(field, option.value, event.currentTarget.checked)} />
                  <label class="pano-ticket-fields-form__check-label form-check-label" for="{id}-{option.value}">{option.label}</label>
                </div>
              {/each}
            </div>
          {:else}
            <input
              {id}
              type="text"
              class="pano-ticket-fields-form__input form-control"
              class:is-invalid={!!code}
              placeholder={field.placeholder || ""}
              maxlength={limits(field).max}
              bind:value={$values[field.key]} />
          {/if}

          {#if code}
            <div class="pano-ticket-fields-form__error invalid-feedback d-block">{errorText(field, code)}</div>
          {/if}
        {/if}

        {#if field.help}
          <div class="pano-ticket-fields-form__help form-text">{field.help}</div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<script>
  import { _ } from "svelte-i18n";

  import { FIELD_ERROR_CODES, fieldLimits } from "$pano/lib/ticketFields.js";

  export let fields = [];
  export let values;
  export let errors = {};

  const limits = (field) => fieldLimits(field);

  function errorText(field, code) {
    const { min, max } = fieldLimits(field);

    return $_(`pages.create-ticket.fields.errors.${FIELD_ERROR_CODES.includes(code) ? code : "INVALID"}`, {
      values: { min: min ?? 0, max: max ?? 0 },
    });
  }

  function toggle(field, optionValue, checked) {
    values.update((current) => {
      const selected = (current[field.key] ?? []).filter((item) => item !== optionValue);

      return { ...current, [field.key]: checked ? [...selected, optionValue] : selected };
    });
  }
</script>
