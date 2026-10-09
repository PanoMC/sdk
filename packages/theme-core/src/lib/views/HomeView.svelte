<!--
  @view HomeView
  Controller: $pano/lib/pages/HomePage.svelte
  Props:
    data.categoryUrl   string|null — active category url when browsing a category's posts, null on the plain home page
    data.category      object — the active category (title, …) when categoryUrl is set
    data.posts         array — posts of the current page
    data.postCount     number — total number of posts
    data.page          number — current page number
    data.totalPages     number — total page count for pagination
    themeSettings      object — theme settings from context; postsEnabled toggles the post list and pagination
    onPageClick        function(data, page) — pagination handler (first/last/page-link clicks)
  Override from a theme:
    theme.config.js → views: { HomeView: () => import("./src/views/HomeView.svelte") }
-->

{#if data.categoryUrl}
  <div class="pano-home-view row justify-content-between mb-3">
    <div class="col-auto">
      <h4>
        {$_("pages.category-posts.title", {
          values: {
            categoryTitle: data.category.title,
            postCount: data.postCount,
          },
        })}
      </h4>
    </div>
    <div class="col-auto">
      <a href={feedPath}>
        <i class="fas fa-arrow-left me-2"></i>
        {$_("pages.category-posts.posts")}
      </a>
    </div>
  </div>
{/if}

<div class="pano-home-view vstack gap-3">
  {#if !data.categoryUrl}
    <Hook name="page:home:top" />
  {/if}

  <!-- Posts -->
  {#if typeof themeSettings.postsEnabled === "undefined" ? true : themeSettings.postsEnabled}
    <Posts posts={data.posts} />
  {/if}
  <!-- Posts End -->

  <!-- Pagination -->
  {#if (typeof themeSettings.postsEnabled === "undefined" ? true : themeSettings.postsEnabled) && data.postCount > 0}
    <Pagination
      page={data.page}
      totalPages={data.totalPages}
      loading={false}
      on:firstPageClick={() => onPageClick(data, 1)}
      on:lastPageClick={() => onPageClick(data, data.totalPages)}
      on:pageLinkClick={(event) => onPageClick(data, event.detail.page)} />
  {/if}
  <!-- Pagination End -->
</div>

<script>
  import { getContext } from "svelte";
  import { _ } from "svelte-i18n";

  import { postsPath } from "$pano/lib/home.js";

  import Hook from "$pano/lib/components/Hook.svelte";
  import Pagination from "$pano/lib/components/Pagination.svelte";
  import Posts from "$pano/lib/components/Posts.svelte";

  export let data;
  export let themeSettings;
  export let onPageClick;

  // "Back to all posts" goes to the feed: "/" while the home page is the feed, "/posts" otherwise.
  const session = getContext("session");

  $: feedPath = postsPath($session?.siteInfo);
</script>
