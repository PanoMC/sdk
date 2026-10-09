import { defineController } from '@panomc/plugin-kit/controller';

export default defineController({
  name: 'greeter',
  version: 1,
  state: () => ({ greeting: 'Hello' }),
  actions: ({ set }) => ({
    setGreeting(greeting) {
      set({ greeting });
    },
  }),
});
