{#each hookList as module, i}
  {@const props = hookProps[i] || {}}
  {@const hasPerm =
    !filteredHooks[i]?.permission ||
    hasPermission(filteredHooks[i]?.permission, $page.data.user)}
  {#if module && hasPerm && typeof module !== 'function'}
    {@const Component = module.default || module}
    {@const isInvisible = props.hookOptions?.invisible || filteredHooks[i]?.invisible}

    {#if !isInvisible}
      <svelte:element
        this={tag}
        class="hook-view-container {rest.class || ''}"
        style="{tag === 'div' ? 'display: contents;' : ''} {rest.style || ''}"
        hookName={name}
        {...props}
        {...rest}>
      </svelte:element>

      <!-- Svelte renders Component natively for both SSR and client -->
      <Component hookName={name} {...props} {...rest} />
    {/if}
  {/if}
{/each}

<script>
  import { panoApiClient } from "$pano/lib/PluginAPI.js";
  import { page } from "$app/stores";
  import { getAllContexts } from "svelte";
  import { hasPermission } from "$pano/lib/auth.util.js";

  let { name, tag = "div", ...rest } = $props();

  const hookStore = $derived(panoApiClient.ui.hook.get(name));

  const filteredHooks = $derived($hookStore || []);

  let resolvedHooks = $state([]);
  const hookList = $derived(
    resolvedHooks.length > 0
      ? resolvedHooks.map((h) => h.component || h)
      : filteredHooks.map((h) => h.component || h),
  );

  const contexts = getAllContexts();

  // Use passed hooks props if available
  const hookProps = $derived($page.data.hookProps?.[name] || []);

  $effect(() => {
    // Sync with store and resolve any functions if needed (Client only)
    const current = filteredHooks.map((h) => h.component || h);
    if (current.some((h) => typeof h === "function" && !h.prototype)) {
      resolveHooks(current);
    } else {
      resolvedHooks = [];
    }
  });

  async function resolveHooks(list) {
    const resolved = await Promise.all(
      list.map(async (h) => {
        if (typeof h === "function" && !h.prototype) {
          return await h();
        }
        return h;
      }),
    );
    resolvedHooks = resolved;
  }
</script>
