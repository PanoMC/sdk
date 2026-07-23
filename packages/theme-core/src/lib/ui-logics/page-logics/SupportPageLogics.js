import SupportSidebar, { load as loadSidebar } from "$pano/lib/components/sidebars/SupportSidebar.svelte";
import { executeHookLoad, executeLifecycle, executeViewLoad, panoApi } from "$pano/lib/PluginAPI.js";

export async function processLoad(event) {
  const { parent } = event;
  const { session, hookProps: parentHookProps } = await parent();
  const themeSettings = session.siteInfo.themeSettings;

  const onlineAdminsEnabled =
    typeof themeSettings.sidebarCarts?.onlineAdmins === "undefined"
      ? true
      : themeSettings.sidebarCarts.onlineAdmins;

  if (onlineAdminsEnabled) {
    await loadSidebar(event);
  }

  const data = {
    hookProps: { ...parentHookProps },
  };

  // Register main content sections
  panoApi.ui.view.register({
    viewId: "support-content",
    id: "support-options",
    priority: 100,
  });

  // Register buttons inside the options group
  panoApi.ui.view.register({
    viewId: "support-options",
    id: "create-ticket",
    component: "local:create-ticket",
    priority: 100,
  });

  panoApi.ui.view.register({
    viewId: "support-options",
    id: "send-email",
    component: "local:send-email",
    priority: 90,
  });

  // Execute lifecycles
  await executeLifecycle("theme:support:load", data, event);

  // View loads and hook load are independent — run in parallel
  const [, , supportHookProps] = await Promise.all([
    executeViewLoad("support-content", event),
    executeViewLoad("support-options", event),
    executeHookLoad("theme:support:content", event)
  ]);

  data.hookProps["theme:support:content"] = {
    ...data.hookProps["theme:support:content"],
    ...supportHookProps
  };

  return { ...data, sidebar: onlineAdminsEnabled ? SupportSidebar : null, pageTitle: "pages.support.title" };
}