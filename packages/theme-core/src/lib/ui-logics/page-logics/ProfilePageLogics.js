import { getProfile } from "$pano/lib/services/profile";
import { executeLifecycle, executeViewLoad, panoApiServer } from "$pano/lib/PluginAPI";

import ProfileSidebar, { load as loadSidebar } from "$pano/lib/components/sidebars/ProfileSidebar.svelte";

/**
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent } = event;
  await parent();

  let data = {
    registerDate: 0,
    lastLoginDate: 0
  };

  // Initialize profile content
  panoApiServer.ui.profile.content.edit((items) => {
    items.push({ id: "profile-card", priority: 100, hidden: false });
  });

  // Initialize profile card rows
  panoApiServer.ui.profile.cardRows.edit((items) => {
    items.push(
      { id: "register-date", priority: 100, hidden: false },
      { id: "last-login", priority: 90, hidden: false }
    );
  });

  await executeLifecycle("theme:profile:load", {}, event);

  // View loads, sidebar, and API call are all independent — run in parallel
  const [, , , profileBody] = await Promise.all([
    executeViewLoad("profile-content", event),
    executeViewLoad("profile-card-rows", event),
    loadSidebar(event),
    getProfile({ request: event })
  ]);

  data = profileBody;

  return { ...data, sidebar: ProfileSidebar, pageTitle: "pages.profile.title" };
}