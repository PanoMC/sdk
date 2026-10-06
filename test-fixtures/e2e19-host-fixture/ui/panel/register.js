import { viewComponent } from '@panomc/sdk/utils/component';
export const PLUGIN_ID = 'tc9-fixture';
export const NODE = 'pano.plugin.tc9-fixture.view.fixture';

export function registerPanel(pano) {
  // PUI-2 items 1 to 3: a page under the player detail layout, reached through a tab that only holders of NODE see
  pano.ui.page.register({
    path: '/players/detail/[username]/fixture',
    component: viewComponent(() => import('./PlayerFixture.svelte')),
    systemLayout: 'PlayerDetailLayout',
    resetLayout: false,
    permission: NODE
  });
  const edited = pano.ui.player?.detail?.editMenu?.((items) => [
    ...items,
    { id: 'fixture', href: '/fixture', text: `plugins.${PLUGIN_ID}.nav-fixture`, startsWith: true, permission: NODE }
  ]);

  // The edit is queued behind other plugins' edits of the same menu (editSerialized). The driver waits for this marker before it counts the tab links of a user
  // WITHOUT the permission: "0 links" only means something once the edit has been applied to the menu store.
  Promise.resolve(edited).then(
    () => {
      if (typeof document !== 'undefined') document.documentElement.dataset.tc9FixtureMenuEdited = '1';
    },
    (error) => console.error('[tc9-fixture] editMenu failed:', error)
  );

  // PUI-2 item 5: the target of the notification's details.href
  pano.ui.page.register({
    path: '/fixture/target',
    component: viewComponent(() => import('./Target.svelte'))
  });

  // PUI-2 item 4: `@panomc/sdk/utils/auth` used to throw in the panel (no context.utils.auth). Imported lazily so the theme's server bundle never evaluates it.
  import('@panomc/sdk/utils/auth').then(
    (auth) => {
      if (typeof auth.hasPermission !== 'function') console.error('[tc9-fixture] hasPermission is not a function');
    },
    (error) => console.error('[tc9-fixture] import @panomc/sdk/utils/auth failed:', error)
  );
}
