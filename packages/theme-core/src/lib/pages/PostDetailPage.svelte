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
  {#if data.post.category.title !== "-"}
    <div class="text-center">
      <a
        class="badge {data.post.category.title !== '-'
          ? 'text-bg-secondary'
          : 'text-bg-primary'} text-decoration-none rounded-pill focus-ring"
        href="/?category={data.post.category.url}"
        use:tooltip={[$_("buttons.filter"), { placement: "bottom" }]}>
        {data.post.category.title}
      </a>
    </div>
  {/if}


  <!-- Kapak görseli + gradient + başlık + footer -->
  {#if (typeof themeSettings.postCoverImageEnabled === "undefined" ? true : themeSettings.postCoverImageEnabled) && data.post.thumbnailUrl}
    <div class="post-detail-cover rounded shadow-sm">
      <div class="ratio ratio-16x9">
        <img
          id="thumbnail"
          src={data.post.thumbnailUrl}
          class="d-block"
          alt={data.post.title}
          title={data.post.title} />
      </div>

      <!-- Başlık + footer -->
      <div class="post-detail-cover__overlay rounded">
        <!-- Footer bilgileri -->
        <div class="d-flex flex-lg-row align-items-end justify-content-between">
          <div
            class="col-lg-3 d-flex align-items-end justify-content-start h-100">
            {#if typeof themeSettings.postViewCountEnabled === "undefined" ? true : themeSettings.postViewCountEnabled}
              <div class="opacity-75">
                <i class="fas fa-eye me-2"></i>
                {data.post.views}
              </div>
            {/if}
          </div>
          <div class="col-lg-6 text-center opacity-75">
            <Date time={data.post.date} />
          </div>
          <div
            class="col-lg-3 d-flex align-items-end justify-content-end opacity-75">
            <a
              href="/player/{data.post.writer.username}"
              class="d-inline-block focus-ring rounded-circle ms-2"
              hidden={typeof themeSettings.postAuthorImageEnabled ===
              "undefined"
                ? false
                : !themeSettings.postAuthorImageEnabled}>
              <img
                src="/api/profile/picture/{data.post.writer
                  .username}?{$avatarVersion}"
                alt={data.post.writer.username}
                width="24"
                height="24"
                use:tooltip={[
                  data.post.writer.username,
                  { placement: "bottom" },
                ]}
                class="rounded-circle" />
            </a>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <div class="card">
    <div class="card-body">
      <div class="card-text text-break word-break">
        {@html data.post.text}
      </div>
    </div>
    {#if !(data.post.thumbnailUrl && (typeof themeSettings.postCoverImageEnabled === "undefined" ? true : themeSettings.postCoverImageEnabled))}
      <div class="card-footer">
        <div class="d-flex align-items-center justify-content-between small">
          {#if typeof themeSettings.postViewCountEnabled === "undefined" ? true : themeSettings.postViewCountEnabled}
            <div>
              <i class="fas fa-eye me-2"></i>
              {data.post.views}
            </div>
          {/if}

          <div class="d-flex align-items-center">
            <Date time={data.post.date} />
            <a
              href="/player/{data.post.writer.username}"
              class="d-inline-block rounded focus-ring rounded-circle ms-2"
              hidden={typeof themeSettings.postAuthorImageEnabled ===
              "undefined"
                ? false
                : !themeSettings.postAuthorImageEnabled}>
              <img
                src="/api/profile/picture/{data.post.writer
                  .username}?{$avatarVersion}"
                alt={data.post.writer.username}
                width="28"
                height="28"
                use:tooltip={[
                  data.post.writer.username,
                  { placement: "bottom" },
                ]}
                class="rounded-circle" />
            </a>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <div class="row justify-content-between">
    <div class="col-auto">
      <a
        href="/post/{data.previousPost === '-' ? '' : data.previousPost.url}"
        class="btn btn-link ps-0"
        class:disabled={data.previousPost === "-"}
        hidden={typeof themeSettings.postPreviousPageEnabled === "undefined"
          ? false
          : !themeSettings.postPreviousPageEnabled}
        use:tooltip={[data.previousPost.title, { placement: "bottom" }]}>
        <i class="fas fa-caret-left me-1"></i>
        {$_("pages.post-detail.previous-post")}
      </a>
    </div>

    <div class="col-auto">
      <a
        href="/post/{data.nextPost === '-' ? '' : data.nextPost.url}"
        class="btn btn-link pe-0"
        class:disabled={data.nextPost === "-"}
        hidden={typeof themeSettings.postNextPageEnabled === "undefined"
          ? false
          : !themeSettings.postNextPageEnabled}
        use:tooltip={[data.nextPost.title, { placement: "bottom" }]}>
        {$_("pages.post-detail.next-post")}
        <i class="fas fa-caret-right ms-1"></i>
      </a>
    </div>
  </div>

  <Hook name="theme:post-detail:bottom" post={data.post} />
</div>

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/PostDetailPageLogics";

  /**
   * @type {import('@sveltejs/kit').Load}
   */
  export async function load(event) {
    return processLoad(event);
  }
</script>

<script>
  import { getContext } from "svelte";
  import { _ } from "svelte-i18n";
  import { avatarVersion } from "$pano/lib/Store";

  import tooltip from "$pano/lib/tooltip.util";

  import { truncate } from "$pano/lib/string.util";
  import Date from "$pano/lib/components/Date.svelte";
  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import Hook from "$pano/lib/components/Hook.svelte";

  export let data;

  const themeSettings = getContext("themeSettings");
  const session = getContext("session");
</script>
