<!--
  View catalogue, the list (doc 02 section 7). Theme dev mode only: the generated route imports this file
  dynamically behind `dev`.
-->
<svelte:head>
  <title>Views - catalogue</title>
</svelte:head>

<div class="catalogue">
  <header class="head">
    <h1>View catalogue</h1>
    <p class="muted">
      {data.rows.length} of {data.total} views
      <span class="sep">·</span>
      <a href="/__pano/views.json">views.json</a>
    </p>
  </header>

  <form class="filters" method="get" action="/__pano/views">
    {#each FILTERS as filter (filter.key)}
      <label>
        <span>{filter.label}</span>
        <select name={filter.key} value={data.filters[filter.key]} onchange={(event) => event.currentTarget.form.requestSubmit()}>
          <option value="">all</option>
          {#each data.options[filter.key] as option (option)}
            <option value={option} selected={data.filters[filter.key] === option}>{option === "pano" ? "pano (engine)" : option}</option>
          {/each}
        </select>
      </label>
    {/each}
    {#if data.filters.plugin || data.filters.kind || data.filters.status}
      <a class="reset" href="/__pano/views">clear</a>
    {/if}
  </form>

  <table>
    <thead>
      <tr>
        <th>View</th>
        <th>Kind</th>
        <th>Contract</th>
        <th>Status</th>
        <th>Sample states</th>
        <th>Badges</th>
      </tr>
    </thead>
    <tbody>
      {#each data.rows as row (row.id)}
        <tr>
          <td>
            <a class="id" href={row.url}>{row.id}</a>
            {#if row.pluginId}<span class="muted small">{row.pluginId}</span>{/if}
          </td>
          <td>{row.kind}</td>
          <td>{row.contract}</td>
          <td><span class="status" data-status={row.status.replace(" ", "-")}>{row.status}</span></td>
          <td>
            {#each row.states as state (state)}
              <a class="chip" href={stageUrl(row.id, { state })}>{state}</a>
            {:else}
              <span class="muted small"
                >{row.pluginId ? "none: run " : "none: add "}<code>{row.pluginId ? `pano-plugin samples ${row.name}` : `${row.name}.samples.js`}</code></span>
            {/each}
          </td>
          <td>
            {#each row.badges as badge (badge)}
              <span class="badge">{badge}</span>
            {/each}
          </td>
        </tr>
      {:else}
        <tr><td colspan="6" class="muted">No view matches the filters.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<script>
  import { stageUrl } from "./model.js";

  let { data } = $props();

  const FILTERS = [
    { key: "plugin", label: "Plugin" },
    { key: "kind", label: "Kind" },
    { key: "status", label: "Status" },
  ];
</script>

<style>
  .catalogue {
    font-family: system-ui, sans-serif;
    color: var(--bs-body-color, #1c1c1c);
    padding: 1rem 0;
  }
  .head h1 {
    font-size: 1.5rem;
    margin: 0 0 0.25rem;
  }
  .muted {
    opacity: 0.7;
  }
  .small {
    font-size: 0.8rem;
  }
  .sep {
    margin: 0 0.4rem;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: end;
    margin: 1rem 0;
  }
  .filters label {
    display: grid;
    gap: 0.2rem;
    font-size: 0.8rem;
  }
  .filters select {
    min-width: 11rem;
    padding: 0.3rem 0.4rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid rgba(128, 128, 128, 0.3);
    vertical-align: top;
  }
  .id {
    font-weight: 600;
    margin-right: 0.4rem;
  }
  .chip,
  .badge,
  .status {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    margin: 0 0.2rem 0.2rem 0;
    border-radius: 999px;
    border: 1px solid rgba(128, 128, 128, 0.5);
    font-size: 0.75rem;
    text-decoration: none;
  }
  .status[data-status="overridden"] {
    border-color: #2c8a4b;
    color: #2c8a4b;
  }
  .status[data-status="override-outdated"] {
    border-color: #c0392b;
    color: #c0392b;
  }
  code {
    font-size: 0.8rem;
  }
</style>
