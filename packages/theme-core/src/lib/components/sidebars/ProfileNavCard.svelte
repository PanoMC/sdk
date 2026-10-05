<div class="card">
  <div class="list-group list-group-flush">
    {#each entries as entry (entry.id)}
      <a
        class="list-group-item list-group-item-action d-flex align-items-center"
        class:active={entry.active}
        aria-current={entry.active ? "page" : undefined}
        href={entry.href}>
        {#if entry.icon}
          <i class="{entry.icon} fa-fw me-2" aria-hidden="true"></i>
        {/if}
        {entry.text}
        {#if entry.badge}
          <span class="badge text-bg-primary ms-auto">{entry.badge}</span>
        {/if}
      </a>
    {/each}
  </div>
</div>

<script>
  // Render entries built by buildProfileNavEntries (profileNav.util.js): { id, href, text, icon, badge, active }.
  let { entries = [] } = $props();
</script>
