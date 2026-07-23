import { getPostPreview } from "$pano/lib/services/posts";

/**
 * @type {import("@sveltejs/kit").Load}
 */
export async function processLoad(event) {
  const { parent } = event;

  const parentData = await parent();

  const { session } = parentData;
  const { user } = session;

  if (!user && !user.panelAccess) {
    return {
      status: 302,
      redirect: "/"
    };
  }

  let data = {
    post: {

      id: -1,
      title: "",
      category: "-",
      writer: {
        username: ""
      },
      text: "",
      date: 0,
      status: 1,
      image: "",
      views: 0
    },
    previousPost: "-",
    nextPost: "-"
  };

  await getPostPreview({ id: event.params.id, request: event }).then(
    (body) => {
      if (body.error) {
        data = {};

        return;
      }

      data.post = body;
    }
  );

  return data;
}