import { defineController } from '@panomc/plugin-kit/controller';

export default defineController({
  name: 'stats',
  version: 1,
  state: () => ({ total: 0, signedIn: false }),
  actions: ({ host, set }) => ({
    refresh() {
      set({ signedIn: host.session().user !== null });
    },
  }),
  load: async ({ host }) => {
    const body = await host.request({ path: '/plugins/pano-plugin-goals/stats' });

    return { total: body?.total ?? 0 };
  },
});
