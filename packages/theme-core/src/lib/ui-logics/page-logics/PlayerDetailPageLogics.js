import { error } from "@sveltejs/kit";

import { getPlayerProfile } from "$pano/lib/services/profile";

import PlayerDetailSidebar, { load as loadSidebar } from "$pano/lib/components/sidebars/PlayerDetailSidebar.svelte";

/**
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent } = event;
  await parent();

  let data = {
    registerDate: 0
  };

  // Sidebar and player profile API are independent — run in parallel
  const [, profileBody] = await Promise.all([
    loadSidebar(event),
    getPlayerProfile({ username: event.params.player, request: event })
  ]);

  if (profileBody.error) {
    if (profileBody.error === "NOT_EXISTS") {
      throw error(404, profileBody.error);
    }

    throw error(500, profileBody.error);
  }

  data = profileBody;

  return {
    ...data,
    sidebar: PlayerDetailSidebar,
    sidebarProps: { side: "left" },
    pageTitle: "pages.player-profile.title"
  };
}