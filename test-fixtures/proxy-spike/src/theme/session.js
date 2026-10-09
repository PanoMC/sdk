import { getPanoContext } from '@panomc/sdk/internal';

/** The same read as the plugin's, written in theme code (theme copy of the SDK on the server). */
export function readThemeSession() {
  const page = getPanoContext().context.page;
  let value;

  page?.subscribe?.((v) => (value = v))?.();

  return { user: value?.data?.session?.user ?? null };
}
