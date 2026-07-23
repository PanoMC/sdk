<!--
  @view PreviewPostView
  Controller: $pano/lib/pages/PreviewPostPage.svelte
  Props:
    data           object — full page data from load (post, previousPost, nextPost)
    post           object — the post being previewed (title, category, writer, text, date, views, thumbnailUrl)
    themeSettings  object — theme settings context (postCoverImageEnabled, postViewCountEnabled)
    avatarVersion  store — cache-busting query value for profile pictures (use as $avatarVersion)
  Override from a theme:
    theme.config.js → views: { PreviewPostView: () => import("./src/views/PreviewPostView.svelte") }
-->
<style lang="scss">
  .post-detail-cover {
    position: relative;
    overflow: hidden;
  }

  .post-detail-cover .ratio {
    min-height: 300px;
  }

  .post-detail-cover #thumbnail {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .post-detail-cover__overlay {
    position: absolute;
    inset: 0;
    padding: 1.5rem;
    color: #fff;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.7), transparent);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 1rem;
  }
</style>

<div class="vstack gap-3">
  <h5 class="card-title mb-0">{$_("pages.preview-post.title", {values: {postTitle: post.title}})}</h5>

  {#if post.category.title !== "-"}
    <div class="text-center">
      <span
        class="badge {post.category.title !== '-'
          ? 'text-bg-secondary'
          : 'text-bg-primary'} text-decoration-none rounded-pill focus-ring">
        {post.category.title}
      </span>
    </div>
  {/if}

  <!-- Cover image + gradient + footer -->
  {#if (typeof themeSettings.postCoverImageEnabled === "undefined" ? true : themeSettings.postCoverImageEnabled) && post.thumbnailUrl}
    <div class="post-detail-cover rounded shadow-sm">
      <div class="ratio ratio-16x9">
        <img
          id="thumbnail"
          src={post.thumbnailUrl}
          class="d-block"
          alt={post.title}
          title={post.title} />
      </div>

      <!-- Footer info -->
      <div class="post-detail-cover__overlay rounded">
        <div class="d-flex flex-lg-row align-items-end justify-content-between">
          <div
            class="col-lg-3 d-flex align-items-end justify-content-start h-100">
            {#if typeof themeSettings.postViewCountEnabled === "undefined" ? true : themeSettings.postViewCountEnabled}
              <div class="opacity-75">
                <i class="fas fa-eye me-2"></i>
                {post.views}
              </div>
            {/if}
          </div>
          <div class="col-lg-6 text-center opacity-75">
            <Date time={post.date} />
          </div>
          <div
            class="col-lg-3 d-flex align-items-end justify-content-end opacity-75">
            <span class="d-inline-block focus-ring rounded-circle ms-2">
              <img
                src="/api/profile/picture/{post.writer
                  .username}?{$avatarVersion}"
                alt={post.writer.username}
                width="24"
                height="24"
                use:tooltip={[
                  post.writer.username,
                  { placement: "bottom" },
                ]}
                class="rounded-circle" />
            </span>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <div class="card">
    <div class="card-body">
      <div class="card-text text-break word-break">
        {@html post.text}
      </div>
    </div>
    {#if !(post.thumbnailUrl && (typeof themeSettings.postCoverImageEnabled === "undefined" ? true : themeSettings.postCoverImageEnabled))}
      <div class="card-footer">
        <div class="d-flex align-items-center justify-content-between small">
          {#if typeof themeSettings.postViewCountEnabled === "undefined" ? true : themeSettings.postViewCountEnabled}
            <div>
              <i class="fas fa-eye me-2"></i>
              {post.views}
            </div>
          {/if}

          <div class="d-flex align-items-center">
            <Date time={post.date} />
            <span class="d-inline-block rounded focus-ring rounded-circle ms-2">
              <img
                src="/api/profile/picture/{post.writer
                  .username}?{$avatarVersion}"
                alt={post.writer.username}
                width="28"
                height="28"
                use:tooltip={[
                  post.writer.username,
                  { placement: "bottom" },
                ]}
                class="rounded-circle" />
            </span>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<script>
  import { _ } from "svelte-i18n";
  import tooltip from "$pano/lib/tooltip.util";

  import Date from "$pano/lib/components/Date.svelte";

  export let data;
  export let post;
  export let themeSettings;
  export let avatarVersion;
</script>
