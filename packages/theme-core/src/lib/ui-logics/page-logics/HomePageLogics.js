import { error } from "@sveltejs/kit";

import { goto } from "$app/navigation";

import { getPosts } from "$pano/lib/services/posts";
import { buildQueryParams } from "$pano/lib/api.util";

import HomeSidebar, { load as loadSidebar } from "$pano/lib/components/sidebars/HomeSidebar.svelte";
import { executeHookLoad } from "$pano/lib/PluginAPI.js";

/**
 * @type {import("@sveltejs/kit").PageLoad}
 */
export async function processLoad(event) {
  const { parent, url: { searchParams } } = event;
  const parentData = await parent();

  const page = parseInt(searchParams.get("page")) || 1;
  const categoryUrl = searchParams.get("category");

  // Posts fetch, sidebar load, and hook load are independent — run in parallel
  const parallelTasks = [getPosts({ page, categoryUrl, request: event })];

  if (!categoryUrl) {
    parallelTasks.push(loadSidebar(event));
    parallelTasks.push(executeHookLoad("page:home:top", event));
  }

  const [data, , homeTopHookProps] = await Promise.all(parallelTasks);

  if (data.error) {
    if (data.error === "PAGE_NOT_FOUND" || data.error === "NOT_EXISTS" || data.error === "CATEGORY_NOT_EXISTS" || data.error === "BAD_REQUEST") {
      throw error(404, data.error);
    }

    throw error(500, data.error);
  }

  data.page = page;
  data.categoryUrl = categoryUrl;

  return {
    ...data,
    sidebar: categoryUrl ? null : HomeSidebar,
    hookProps: categoryUrl ? undefined : {
      ...parentData.hookProps,
      "page:home:top": homeTopHookProps
    }
  };
}

async function refreshData(data) {
  const queryParams = buildQueryParams({
    page: data.page,
    category: data.categoryUrl
  });

  await goto(queryParams);
}

export async function onPageClick(data, page) {
  data.page = page;

  await refreshData(data);
}