import { defineController } from '@panomc/plugin-kit/controller';

export default defineController({
  name: 'plain',
  version: 1,
  state: () => ({ count: 0 }),
  actions: ({ update }) => ({
    bump() {
      update((state) => ({ count: state.count + 1 }));
    },
  }),
});
