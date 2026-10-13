import { error, redirect } from "@sveltejs/kit";

import { getPostPreview } from "$pano/lib/services/posts";

/**
 * The preview of a post for its author: `/preview/post/<id>` for a saved post (draft or not) and
 * `/preview/post/<token>` for the panel editor's unsaved content.
 *
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent } = event;

  const parentData = await parent();

  const user = parentData.session?.user;

  // A preview is for people who may use the panel. (This used to read `!user && !user.panelAccess`,
  // which threw for a visitor who was not signed in and let a signed-in one without access through.)
  if (!user || !user.panelAccess) {
    throw redirect(302, "/");
  }

  const body = await getPostPreview({ id: event.params.id, request: event });

  if (!body || body.error) {
    const code = body?.error?.code;

    // A draft token that expired or belongs to someone else reads as "not found" too.
    if (code === "POST_NOT_FOUND" || code === "NOT_FOUND") {
      throw error(404, code);
    }

    if (code === "NOT_LOGGED_IN" || code === "NO_PERMISSION") {
      throw redirect(302, "/");
    }

    throw error(500, code);
  }

  return {
    post: body.post,
    previousPost: body.previousPost ?? "-",
    nextPost: body.nextPost ?? "-"
  };
}
