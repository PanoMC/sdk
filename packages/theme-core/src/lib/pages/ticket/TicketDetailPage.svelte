<style global>
  .answer {
    margin-bottom: 0;
  }

  .answer :global(p:last-child) {
    margin-bottom: 0;
  }
</style>

<div class="vstack gap-3">
  <PageTitle
    title={`#${$ticket.id} ${$ticket.title}`}
    subtitle={$_("pages.ticket-detail.detail.opened-in-category", {
      values: {
        category: `<a
  href="/tickets?category=${$ticket.category.url}"
  title="${$_("pages.ticket-detail.filter")}"
  >${
    $ticket.category === "-"
      ? $_("pages.ticket-detail.no-category")
      : $ticket.category.title
  }
</a>`,
      },
    })}
    subtitleHtml={true} />

  <div class="card mt-lg-0">
    <CardHeader>
      <small slot="left" class="text-body-secondary">
        <Date time={$ticket.date} relativeFormat={true} />
      </small>
      <div slot="right">
        <TicketStatus status={$ticket.status} />
      </div>
    </CardHeader>
    <div class="card-body" id="messageSection" bind:this={$messagesSectionDiv}>
      {#if $messages.length < $ticket.messageCount && $ticket.messageCount > 5}
        <div class="d-flex justify-content-center mb-3">
          <button
            class="btn btn-sm btn-secondary"
            class:disabled={$loadMoreLoading}
            on:click={() => loadMore(loadMoreLoading, messages, data)}
            ><i class="fas fa-arrow-up me-1"></i>
            {$_("pages.ticket-detail.previous-messages", {
              values: {
                count:
                  $ticket.messageCount - ($messages.length - $sentMessageCount),
              },
            })}
          </button>
        </div>
      {/if}

      <div class="vstack gap-2">
        {#each $messages as message, index (message)}
          {#if message.panel}
            <div class="row g-2 flex-nowrap">
              <div class="col-auto">
                <a href="/player/{message.username}">
                  <img
                    src="/api/profile/picture/{message.username}?{$avatarVersion}"
                    alt={message.username}
                    class="rounded-circle animate__animated animate__zoomIn"
                    use:tooltip={[message.username, { placement: "bottom" }]}
                    width="48"
                    height="48" />
                </a>
              </div>
              <div class="col vstack align-items-start">
                <div class="card rounded-5 text-bg-primary border-0 shadow-sm">
                  <div class="card-body answer px-3 py-2">
                    {@html message.message}
                  </div>
                </div>
                <small class="text-body-secondary mt-1">
                  <Date time={message.date} relativeFormat={true} />
                </small>
              </div>
            </div>
          {:else}
            <div class="row g-2 flex-nowrap">
              <div class="col vstack align-items-end">
                <div class="card rounded-5 bg-transparent border shadow-sm">
                  <div class="card-body px-3 py-2">
                    {message.message}
                  </div>
                </div>
                <small class="text-body-secondary mt-1">
                  <Date time={message.date} relativeFormat={true} />
                </small>
              </div>
              <div class="col-auto">
                <a href="/player/{message.username}">
                  <img
                    src="/api/profile/picture/{message.username}?{$avatarVersion}"
                    alt={message.username}
                    class="rounded-circle animate__animated animate__zoomIn"
                    use:tooltip={[message.username, { placement: "bottom" }]}
                    width="48"
                    height="48" />
                </a>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    </div>
    <div
      class="card-footer"
      class:d-none={$ticket.status === TicketStatuses.CLOSED}>
      <div class="input-group">
        <textarea
          placeholder={$_("pages.ticket-detail.inputs.message.placeholder")}
          class="form-control"
          bind:value={$message}></textarea>
        <button
          class="btn btn-secondary border-left-0"
          disabled={$messageSendLoading || isSendButtonDisabled}
          class:disabled={$messageSendLoading || isSendButtonDisabled}
          on:click={() =>
            sendMessage(
              messageSendLoading,
              sentMessageCount,
              shouldScroll,
              messages,
              message,
              data,
            )}
          title={$_("buttons.send")}
          aria-label={$_("buttons.send")}>
          <i class="fas fa-paper-plane"></i>
        </button>
      </div>
    </div>
  </div>
</div>

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/TicketDetailPageLogics.js";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    return processLoad(event);
  }
</script>

<script>
  import { _ } from "svelte-i18n";
  import { avatarVersion } from "$pano/lib/Store";

  import {
    init,
    loadMore,
    sendMessage,
  } from "$pano/lib/ui-logics/page-logics/TicketDetailPageLogics";

  import Date from "$pano/lib/components/Date.svelte";
  import tooltip from "$pano/lib/tooltip.util";

  import TicketStatus, {
    TicketStatuses,
  } from "$pano/lib/components/TicketStatus.svelte";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import CardHeader from "$pano/lib/components/CardHeader.svelte";

  export let data;

  const {
    message,
    messageSendLoading,
    messagesSectionDiv,
    loadMoreLoading,
    shouldScroll,
    sentMessageCount,
    messages,
    ticket,
  } = init(data);

  $: isSendButtonDisabled = $message === "";
</script>
