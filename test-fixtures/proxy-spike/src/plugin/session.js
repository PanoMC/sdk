import { getPanoContext } from '@panomc/sdk/internal';

/**
 * The session as a plugin view reads it: through the SDK pano context (the one object both Svelte copies share on the
 * server), never through getContext. `context.page` is the SvelteKit page store; its `data.session` carries the user.
 *
 * @returns {{ user: string | null }}
 */
export function readSession() {
  const page = getPanoContext().context.page;
  let value;

  page?.subscribe?.((v) => (value = v))?.();

  return { user: value?.data?.session?.user ?? null };
}
