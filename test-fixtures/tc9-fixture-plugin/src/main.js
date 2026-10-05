import { PanoPlugin } from '@panomc/sdk';
import { viewComponent } from '@panomc/sdk/utils/component';

// TC-9 fixture plugin (theme-core test-fixtures, not shipped). Every page uses Page.svelte,
// whose load() switches on the path; see ../README.md for the seven checks.
const page = viewComponent(() => import('./Page.svelte'));
const item = viewComponent(() => import('./SidebarItem.svelte'));

export default class Tc9FixturePlugin extends PanoPlugin {
  onLoad() {
    const pano = this.pano;
    if (pano.isPanel) return;

    // 1. login return URL: a guest is sent to /login?redirect=/fixture/login-required
    pano.ui.page.register({ path: '/fixture/login-required', component: page, loginRequired: true });
    // 2. host Hook rendered from getPanoContext().context.components.Hook
    pano.ui.page.register({ path: '/fixture/hook', component: page });
    // 3. head metadata: one description, og:image, canonical, JSON-LD
    pano.ui.page.register({ path: '/fixture/meta', component: page });
    // 4. profile sub-page: profile card + nav, the fixture item active
    pano.ui.page.register({ path: '/profile/fixture', component: page, systemLayout: 'ProfileLayout', loginRequired: true });
    pano.ui.profile?.nav?.edit?.((items) => {
      items.push({ id: 'fixture', priority: 85, props: { href: '/profile/fixture', text: 'Fixture', icon: 'fas fa-flask', startsWith: true } });
    });
    // 5. plugin sidebars: "plugin:fixture-empty" has no items (full width), "plugin:fixture" has one
    pano.ui.page.register({ path: '/fixture/sidebar-empty', component: page });
    pano.ui.page.register({ path: '/fixture/sidebar-one', component: page });
    pano.ui.sidebar.register({ sidebarId: 'fixture', id: 'fixture-card', component: item, priority: 10 });
    // 6. toast values are escaped
    pano.ui.page.register({ path: '/fixture/toast', component: page });
    // 7. title control: raw + hidden
    pano.ui.page.register({ path: '/fixture/title', component: page });
  }

  onContextUpdate() {}

  onUnload() {}
}
