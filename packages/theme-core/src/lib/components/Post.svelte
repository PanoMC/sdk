<style global lang="scss">
  .clamp-title {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }

  .clamp-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .vanilla-post-card {
    transition:
      transform 0.2s ease-in-out;
    overflow: hidden;
    &:not(.post-detail) {
      min-height: 240px;
    }

    &.is-overlay {
      .card-img-overlay {
        transition: background 0.4s ease;
      }

      &:not(.has-thumbnail) {
        h3, .card-text {
          color: var(--bs-body-color) !important;
          text-shadow: none;
        }
      }

      &.has-thumbnail {
        .card-img-overlay {
          background: linear-gradient(to top, rgba(0, 0, 0, 0.2) 0%, transparent 90%);
        }

        h3, .card-text {
          color: var(--bs-white) !important;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        }

        :global(.small) {
          color: rgba(255, 255, 255, 0.8) !important;
        }
      }

      .category-badge {
        background-color: transparent !important;
        border: 1px solid rgba(255, 255, 255, 0.4) !important;
        color: var(--bs-white) !important;
      }
    }

    &:hover {
      transform: translateY(-4px);
      box-shadow: var(--bs-box-shadow-lg) !important;
    }
  }

  .card-img {
    transition: transform 0.4s ease, filter 0.4s ease;
  }

  .post-card-thumbnail-wrapper {
    display: block;
    width: 100%;
    overflow: hidden;
  }

  .post-card-thumbnail-wrapper img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.4s ease-in-out;
  }
  .category-badge {
    background-color: transparent !important;
    border: 1px solid var(--bs-emphasis-color) !important;
    color: var(--bs-emphasis-color) !important;
    transition: all 0.2s;

    &:hover {
      background-color: var(--bs-emphasis-color) !important;
      color: var(--bs-body-bg) !important;
      opacity: 1;
    }
  }

  /* Make link-secondary work on span and use theme secondary color (emphasis for contrast) */
  .link-secondary {
    color: var(--bs-secondary-text-emphasis) !important;
    transition: color 0.4s;
  }

  .vanilla-post-card:hover .link-secondary {
    color: var(--bs-secondary) !important;
    opacity: 1;
  }
</style>

<div
  class="card vanilla-post-card h-100 rounded-4 focus-ring position-relative overflow-hidden"
  class:post-clickable={!detail}
  class:post-detail={detail}
  class:is-overlay={!detail}
  class:has-thumbnail={!detail && post.thumbnailUrl}>

  {#if !detail && post.thumbnailUrl}
    <img
      src={post.thumbnailUrl}
      class="card-img h-100 object-fit-cover"
      alt={post.title} />
  {/if}

  {#if (typeof themeSettings.postCoverImageEnabled === "undefined" ? true : themeSettings.postCoverImageEnabled) && detail && post.thumbnailUrl}
    <div class="post-card-thumbnail-wrapper d-block">
      <div class="ratio ratio-16x9">
        <img
          src={post.thumbnailUrl}
          class="card-img-top"
          alt={post.title}
          title={post.title} />
      </div>
    </div>
  {/if}

  <div
    class:card-img-overlay={!detail}
    class:card-body={detail}
    class="d-flex flex-column justify-content-end">
    <div class="d-flex justify-content-between align-items-start mb-3 gap-2 mt-auto">
      <a
        class="text-decoration-none rounded text-reset flex-grow-1 z-1"
        class:stretched-link={!detail}
        href="/post/{post.url}">
        <h3 class="mb-0 text-break h4 fw-bold clamp-title" title={post.title}>
          {post.title}
        </h3>
      </a>
    </div>

    <div
      class="card-text text-break word-break mb-4"
      class:text-muted={detail || !post.thumbnailUrl}
      class:clamp-text={!detail}>
      {#if detail}
        {@html post.text}
      {:else}
        {truncate(post.text.replace(/<[^>]*>?/gm, ""), 80)}...
      {/if}
    </div>

    <div class="d-flex align-items-center justify-content-between">
      {#if detail}
        {#if typeof themeSettings.postViewCountEnabled === "undefined" ? true : themeSettings.postViewCountEnabled}
          <div
            class="text-muted small d-flex align-items-center"
            use:tooltip={[$_("components.post.view"), { placement: "bottom" }]}>
            <i class="fas fa-eye me-2"></i>
            {post.views}
          </div>
        {:else}
          <div></div>
        {/if}

        <div class="d-flex align-items-center gap-2">
          <Date time={post.date} class="text-muted small" />
          <a
            href="/player/{post.writer.username}"
            class="d-inline-block rounded focus-ring rounded-circle"
            hidden={typeof themeSettings.postAuthorImageEnabled === "undefined"
              ? false
              : !themeSettings.postAuthorImageEnabled}>
            <img
              src="/api/profile/picture/{post.writer.username}?{$avatarVersion}"
              alt={post.writer.username}
              width="32"
              height="32"
              use:tooltip={[post.writer.username, { placement: "bottom" }]}
              class="rounded-circle border" />
          </a>
        </div>
      {:else}
        {#if post.category.title !== "-"}
          <a
            class="badge category-badge text-decoration-none rounded-pill focus-ring z-2"
            href="/?category={post.category.url}"
            use:tooltip={[$_("buttons.filter"), { placement: "bottom" }]}>
            {post.category.title}
          </a>
        {:else}
          <div></div>
        {/if}

        <div class="d-flex align-items-center gap-2 z-2">
          <Date time={post.date} class="small" />
          <a
            class="d-inline-block rounded focus-ring rounded-circle"
            href="/player/{post.writer.username}"
            hidden={typeof themeSettings.postAuthorImageEnabled === "undefined"
              ? false
              : !themeSettings.postAuthorImageEnabled}>
            <img
              src="/api/profile/picture/{post.writer.username}?{$avatarVersion}"
              alt={post.writer.username}
              width="28"
              height="28"
              use:tooltip={[post.writer.username, { placement: "bottom" }]}
              class="rounded-circle border border-2 border-white" />
          </a>
        </div>
      {/if}
    </div>
  </div>
</div>

<script>
  import { getContext } from "svelte";
  import { _ } from "svelte-i18n";

  import { truncate } from "$pano/lib/string.util";
  import tooltip from "$pano/lib/tooltip.util";

  import Date from "$pano/lib/components/Date.svelte";

  export let post;
  export let detail = false;

  import { avatarVersion } from "$pano/lib/Store";
  const themeSettings = getContext("themeSettings");
</script>
