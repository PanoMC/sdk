import { requireNotLogin } from "$pano/lib/Store";

export async function processLoad({ parent }) {
  const parentData = await parent();
  const { session } = parentData;

  requireNotLogin(session);

  return parentData;
}