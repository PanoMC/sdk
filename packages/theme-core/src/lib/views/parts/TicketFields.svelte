<!--
  Default markup of the engine's <TicketFields> (registry name "TicketFields", contract 1): the custom
  field values of a ticket as a compact "label: value" card. Renders nothing without entries.

  Props:
    entries  array — the fields that have a value, in order: { key, label, type, value, text, href }
             (`text` is the readable value; `href` is set only for an http(s) URL or an e-mail)
-->
{#if entries.length > 0}
  <div class="pano-ticket-fields card">
    <div class="pano-ticket-fields__body card-body py-2">
      <dl class="pano-ticket-fields__list row mb-0">
        {#each entries as entry (entry.key)}
          <dt class="pano-ticket-fields__label col-sm-4 text-body-secondary fw-normal">{entry.label}</dt>
          <dd class="pano-ticket-fields__value col-sm-8 mb-1 text-break">
            {#if entry.href}
              <a href={entry.href} target={entry.type === "URL" ? "_blank" : undefined} rel="noopener noreferrer nofollow"
                >{entry.text}</a>
            {:else}
              {entry.text}
            {/if}
          </dd>
        {/each}
      </dl>
    </div>
  </div>
{/if}

<script>
  export let entries = [];
</script>
