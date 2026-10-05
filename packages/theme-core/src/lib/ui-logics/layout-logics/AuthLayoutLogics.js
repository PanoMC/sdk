import { requireNotLogin } from "$pano/lib/Store";

export async function processLoad(event) {
  const { parent } = event;
  const parentData = await parent();
  const { session } = parentData;

  requireNotLogin(session, event);

  return parentData;
}