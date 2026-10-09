<!--
  View catalogue, the stage (doc 02 section 7): one view with one sample state. Theme dev mode only.

  While this component is mounted the controller registry is in sample mode: every `use()` returns a
  fixed-state controller (the sample's patch merged over its initial state) whose actions only record
  `{ name, args }`, and the real cache is never touched. Leaving the stage turns it off again.
-->
<svelte:head>
  <title>{data.id} - catalogue</title>
</svelte:head>

<div class="stage-page" class:bare={data.bare}>
  {#if !data.bare}
    <header class="bar">
      <div>
        <a class="back" href="/__pano/views">views</a>
        <h1>{data.id}</h1>
        <span class="status" data-status={data.row.status.replace(" ", "-")}>{data.row.status}</span>
        <span class="muted small">{data.row.kind} · contract {data.row.contract}</span>
      </div>

      <nav class="switches" aria-label="Stage options">
        <div>
          <span class="label">State</span>
          {#each data.row.states as state (state)}
            <a class="chip" class:on={state === data.state} href={stageUrl(data.id, { state, palette: data.palette, source: data.source })}>{state}</a>
          {:else}
            <span class="muted small">no samples</span>
          {/each}
        </div>
        <div>
          <span class="label">Palette</span>
          <a class="chip" class:on={!data.palette} href={stageUrl(data.id, { state: data.state, source: data.source })}>theme</a>
          {#each PALETTES as palette (palette)}
            <a class="chip" class:on={palette === data.palette} href={stageUrl(data.id, { state: data.state, palette, source: data.source })}>{palette}</a>
          {/each}
        </div>
        <div>
          <span class="label">Source</span>
          {#each ["theme", "default"] as source (source)}
            <a class="chip" class:on={source === data.source} href={stageUrl(data.id, { state: data.state, palette: data.palette, source })}>{source}</a>
          {/each}
          <a class="chip" href={stageUrl(data.id, { state: data.state, palette: data.palette, source: data.source, bare: true })}>bare</a>
        </div>
      </nav>
    </header>
  {/if}

  <div class="layout">
    {#key data.stageKey}
      <div class="canvas" data-bs-theme={data.palette ?? undefined} data-pano-stage={data.id} data-pano-state={data.state ?? ""}>
        {#if !sampleReady}
          <!-- sample mode is switched on before the view is created -->
        {:else if !data.View}
          <p class="note">
            <strong>{data.id}</strong> is not loaded in this theme process: its plugin has not registered it (is the plugin installed and its UI built?).
          </p>
        {:else if !data.sample}
          <p class="note">
            <strong>{data.id}</strong> has no sample state{data.row.states.length ? ` named '${data.requestedState}'` : ""}.
            {#if data.row.pluginId}Run <code>pano-plugin samples {data.row.name}</code> in the plugin.{:else}Add <code>{data.row.name}.samples.js</code> to the engine.{/if}
          </p>
        {:else}
          <View {...data.sample.props}>
            <p class="slot-note">default slot content</p>
          </View>
        {/if}
      </div>
    {/key}

    {#if !data.bare}
      <aside class="panel">
        {#if data.missing.length}
          <section class="warn">
            <h2>Missing props</h2>
            <p>The sample does not give: {data.missing.join(", ")}</p>
          </section>
        {/if}

        {#if data.row.issues.length}
          <section class="warn">
            <h2>Issues</h2>
            <ul>
              {#each data.row.issues as issue (issue.type + (issue.controller ?? ""))}
                <li><code>{issue.type}</code>{issue.controller ? ` (${issue.controller})` : ""}</li>
              {/each}
            </ul>
          </section>
        {/if}

        <section>
          <h2>Props contract</h2>
          {#if propEntries.length}
            <dl>
              {#each propEntries as [name, spec] (name)}
                <dt>{name}{spec.required ? " *" : ""}</dt>
                <dd>{spec.text}</dd>
              {/each}
            </dl>
          {:else}
            <p class="muted small">This view takes no props.</p>
          {/if}
        </section>

        <section>
          <h2>Controllers</h2>
          {#each controllerNames as name (name)}
            <div class="controller">
              <code>{name}</code>
              {#if name in (data.sample?.controllers ?? {})}<span class="muted small">patched: {JSON.stringify(data.sample.controllers[name])}</span>{/if}
            </div>
          {:else}
            <p class="muted small">None used by the sample.</p>
          {/each}
        </section>

        <section>
          <h2>Recorded calls</h2>
          {#each calls as call, index (index)}
            <div class="call"><code>{call.controller}.{call.name}({call.args.map((arg) => JSON.stringify(arg)).join(", ")})</code></div>
          {:else}
            <p class="muted small">No action called yet.</p>
          {/each}
        </section>

        <section>
          <h2>Eject</h2>
          <pre class="command">{data.eject}</pre>
        </section>

        <section>
          <h2>Source <span class="muted small">{data.row.source}</span></h2>
          {#await data.sourceText}
            <p class="muted small">Reading...</p>
          {:then text}
            {#if text}
              <pre class="source">{text}</pre>
            {:else}
              <p class="muted small">The readable source is not available from here.</p>
            {/if}
          {/await}
        </section>
      </aside>
    {/if}
  </div>
</div>

<script>
  import { getContext, onMount, setContext } from "svelte";
  import { derived, readable, writable } from "svelte/store";
  import { list, setSamples, use } from "@panomc/sdk/core/js/ControllerRegistry.js";

  import { PALETTES, stageUrl } from "./model.js";

  let { data } = $props();

  // Sample mode is on before the view is created and off when the stage leaves.
  let sampleReady = $state(false);

  $effect.pre(() => {
    setSamples(data.sample?.controllers ?? {});
    sampleReady = true;
  });

  onMount(() => () => setSamples(null));

  // `session: "guest" | "user"` of a state: the stage's subtree sees that session, the page's own is untouched.
  const FAKE_USER = { id: 1, username: "sample", email: "sample@example.com", permissions: [] };
  const parentSession = getContext("session");
  const sessionMode = writable(null);

  setContext(
    "session",
    parentSession
      ? derived([parentSession, sessionMode], ([$parent, $mode]) =>
          $mode === "guest" ? { ...$parent, user: null } : $mode === "user" ? { ...$parent, user: $parent?.user ?? FAKE_USER } : $parent,
        )
      : readable(undefined),
  );

  $effect.pre(() => {
    sessionMode.set(data.sample?.session ?? null);
  });

  const View = $derived(data.View);

  const propEntries = $derived(
    Object.entries(data.row.props ?? {}).map(([name, spec]) => [
      name,
      typeof spec === "string"
        ? { required: false, text: spec }
        : { required: spec?.required === true, text: `${spec?.type ?? "any"}${spec?.required ? "" : " (optional)"}` },
    ]),
  );

  const controllerNames = $derived(
    [...new Set([...Object.keys(data.sample?.controllers ?? {}), ...data.row.controllers])].sort(),
  );

  // Recorded calls: read from the sample controllers while the stage is up.
  let calls = $state([]);

  onMount(() => {
    const read = () => {
      const names = new Set([...controllerNames, ...list().filter((c) => c.name.startsWith(`${data.row.ns}/`)).map((c) => c.name)]);
      const out = [];
      for (const name of names) {
        for (const call of use(name)?.calls ?? []) out.push({ controller: name, name: call.name, args: call.args ?? [] });
      }
      if (out.length !== calls.length) calls = out;
    };
    const timer = setInterval(read, 400);
    read();

    return () => clearInterval(timer);
  });
</script>

<style>
  .stage-page {
    font-family: system-ui, sans-serif;
    color: var(--bs-body-color, #1c1c1c);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 2rem;
    justify-content: space-between;
    align-items: start;
    padding: 0.75rem 0;
    border-bottom: 1px solid rgba(128, 128, 128, 0.3);
  }
  h1 {
    display: inline;
    font-size: 1.25rem;
    margin: 0 0.5rem;
  }
  .back {
    font-size: 0.85rem;
  }
  .muted {
    opacity: 0.7;
  }
  .small {
    font-size: 0.8rem;
  }
  .switches {
    display: grid;
    gap: 0.35rem;
  }
  .label {
    display: inline-block;
    min-width: 4.5rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    opacity: 0.7;
  }
  .chip,
  .status {
    display: inline-block;
    padding: 0.05rem 0.5rem;
    margin-right: 0.25rem;
    border-radius: 999px;
    border: 1px solid rgba(128, 128, 128, 0.5);
    font-size: 0.75rem;
    text-decoration: none;
  }
  .chip.on {
    background: rgba(128, 128, 128, 0.25);
    font-weight: 600;
  }
  .status[data-status="overridden"] {
    border-color: #2c8a4b;
    color: #2c8a4b;
  }
  .status[data-status="override-outdated"] {
    border-color: #c0392b;
    color: #c0392b;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 22rem;
    gap: 1.5rem;
    margin-top: 1rem;
  }
  .bare .layout {
    display: block;
    margin: 0;
  }
  .canvas {
    min-width: 0;
    padding: 1rem;
    border: 1px dashed rgba(128, 128, 128, 0.5);
    background: var(--bs-body-bg, transparent);
    color: var(--bs-body-color, inherit);
  }
  .bare .canvas {
    border: 0;
    padding: 0;
  }
  .slot-note {
    margin: 0;
    padding: 0.5rem;
    border: 1px dotted rgba(128, 128, 128, 0.5);
    font-size: 0.8rem;
    opacity: 0.7;
  }
  .note {
    margin: 0;
  }
  .panel {
    font-size: 0.85rem;
    min-width: 0;
  }
  .panel h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin: 1rem 0 0.4rem;
  }
  .warn {
    border-left: 3px solid #c0392b;
    padding-left: 0.6rem;
  }
  dl {
    margin: 0;
  }
  dt {
    font-weight: 600;
    font-family: monospace;
  }
  dd {
    margin: 0 0 0.4rem;
    opacity: 0.8;
  }
  .command,
  .source {
    margin: 0;
    padding: 0.5rem;
    background: rgba(128, 128, 128, 0.15);
    overflow: auto;
    max-height: 24rem;
    font-size: 0.75rem;
  }
  .controller,
  .call {
    margin-bottom: 0.25rem;
    word-break: break-word;
  }
  @media (max-width: 900px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
