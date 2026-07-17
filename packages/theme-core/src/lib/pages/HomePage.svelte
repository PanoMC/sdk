
{#if data.categoryUrl}
  <div class="row justify-content-between mb-3">
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
      <a href="/">
        <i class="fas fa-arrow-left me-2"></i>
        {$_("pages.category-posts.posts")}
      </a>
    </div>
  </div>
{/if}

<div class="vstack gap-3">
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
      totalPage={data.totalPage}
      loading={false}
      on:firstPageClick={() => onPageClick(data, 1)}
      on:lastPageClick={() => onPageClick(data, data.totalPage)}
      on:pageLinkClick={(event) => onPageClick(data, event.detail.page)} />
  {/if}
  <!-- Pagination End -->
</div>

<script context="module">
  import { processLoad } from "$pano/lib/ui-logics/page-logics/HomePageLogics";

  /**
   * @type {import('@sveltejs/kit').PageLoad}
   */
  export async function load(event) {
    return processLoad(event);
  }
</script>

<script>
  import { getContext } from "svelte";
  import { _ } from "svelte-i18n";

  import { onPageClick } from "$pano/lib/ui-logics/page-logics/HomePageLogics";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import Hook from "$pano/lib/components/Hook.svelte";
  import Pagination from "$pano/lib/components/Pagination.svelte";
  import Posts from "$pano/lib/components/Posts.svelte";

  export let data;

  const themeSettings = getContext("themeSettings");
</script>
