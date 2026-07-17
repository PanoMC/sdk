import { executeHookLoad } from "$pano/lib/PluginAPI.js";

export async function processLoad(event) {
  const { parent } = event;
  await parent();

  // Both hook loads are independent (different hook names, separate cache entries).
  const [themeTop, pageTop] = await Promise.all([
    executeHookLoad("theme:top", event),
    executeHookLoad("page:top", event)
  ]);

  return {
    hookProps: {
      "theme:top": themeTop,
      "page:top": pageTop
    },
  };
}
