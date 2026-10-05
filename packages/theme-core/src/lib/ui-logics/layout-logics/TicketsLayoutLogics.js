import { requireLogin } from "$pano/lib/Store.js";

export async function processLoad(event) {
  const { parent } = event;
  const parentData = await parent();
  const { session } = parentData;

  requireLogin(session, event);

  return parentData;
}