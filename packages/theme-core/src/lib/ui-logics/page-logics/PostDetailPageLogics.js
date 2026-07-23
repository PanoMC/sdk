import { error } from "@sveltejs/kit";

import { getPostDetail } from "$pano/lib/services/posts";
import { executeHookLoad, executeLifecycle } from "$pano/lib/PluginAPI.js";

/**
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent } = event;
  const { hookProps: parentHookProps } = await parent();

  let data = {
    post: {
      id: -1,
      title: "",
      category: "-",
      writer: {
        username: "",
      },
      text: "",
      date: 0,
      status: 1,
      image: "",
      views: 0,
      url: "",
    },
    previousPost: "-",
    nextPost: "-",
  };

  await getPostDetail({ url: event.params.url, request: event }).then(
    (body) => {
      if (body.error) {
        if (body.error === "POST_NOT_FOUND") {
          throw error(404, body.error);
        }

        throw error(500, body.error);
      }

      data = body;
    },
  );

  data.hookProps = { ...parentHookProps };

  await executeLifecycle("theme:post-detail:load", data, event);

  data.hookProps["theme:post-detail:bottom"] = {
    ...data.hookProps["theme:post-detail:bottom"],
    ...(await executeHookLoad("theme:post-detail:bottom", event)),
  };

  data.pageTitle = data.post.title;

  return { ...data };
}
