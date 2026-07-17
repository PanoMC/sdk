<!--
  @view SupportView
  Controller: $pano/lib/pages/SupportPage.svelte
  Props:
    data         object — page data from load, forwarded to plugin view components
    session      store — session context store; $session.siteInfo supplies supportEmail/websiteName
    items        store — plugin view entries registered for the "support-content" slot
    optionItems  store — plugin view entries registered for the "support-options" slot
  Override from a theme:
    theme.config.js → views: { SupportView: () => import("./src/views/SupportView.svelte") }
-->
<div class="vstack gap-3">

  {#each $items as item (item.id)}
    {#if item.id === "support-options"}
      <ul class="list-group text-center support-list justify-content-center">
        {#each $optionItems as opt (opt.id)}
          {#if opt.id === "create-ticket"}
            <a
              href="/ticket/create"
              class="list-group-item list-group-item-action focus-ring">
              <div class="vstack gap-2 justify-content-center">
                <i class="fas fa-ticket fa-2x"></i>
                <h5>{$_("pages.support.options.create-ticket.title")}</h5>
                <small class="opacity-75">
                  {$_("pages.support.options.create-ticket.description")}
                </small>
              </div>
            </a>
          {:else if opt.id === "send-email"}
            <a
              href="mailto:{$session.siteInfo.supportEmail}"
              class="list-group-item list-group-item-action focus-ring">
              <div class="vstack gap-2 justify-content-center">
                <i class="fas fa-envelope fa-2x"></i>
                <h5>
                  {$_("pages.support.options.send-email.title")}<i
                    class="fas fa-external-link-alt ms-2 small"></i>
                </h5>
                <small class="opacity-75">
                  {$_("pages.support.options.send-email.description", {
                    values: { websiteName: $session.siteInfo.websiteName },
                  })}
                </small>
              </div>
            </a>
          {:else}
            <div class="list-group-item list-group-item-action p-0 overflow-hidden">
              <ViewComponent component={opt.component} data={data} {...opt.props} />
            </div>
          {/if}
        {/each}
      </ul>
    {:else}
      <ViewComponent component={item.component} data={data} {...item.props} />
    {/if}
  {/each}

  <Hook name="theme:support:content" />
</div>

<style>
  .support-list .list-group-item {
    width: 100%;
    padding: 1.5rem;
  }
</style>

<script>
  import { _ } from "svelte-i18n";

  import Hook from "$pano/lib/components/Hook.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  export let data;
  export let session;
  export let items;
  export let optionItems;
</script>
