import { requireLogin } from "$pano/lib/Store.js";

export async function processLoad({ parent }) {
  const parentData = await parent();
  const { session } = parentData;

  requireLogin(session);

  return parentData;
}