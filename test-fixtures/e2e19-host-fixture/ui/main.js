import Theme from './theme.js';
import { viewComponent } from '@panomc/sdk/utils/component';
import { registerPanel } from './panel/register.js';

// E2E-19 fixture entry: the theme side is the TC-9 fixture (../tc9-fixture-plugin, copied by build.sh as theme.js) plus a hook component, so
// "the host Hook rendered a registered hook" is observable (TC-9 item 2); the panel side is PUI-2.
export default class E2e19FixturePlugin extends Theme {
  onLoad() {
    if (this.pano.isPanel) {
      registerPanel(this.pano);
      return;
    }

    super.onLoad();
    this.pano.ui.hook.register({
      name: 'fixture:hook',
      component: viewComponent(() => import('./HookProbe.svelte'))
    });
  }
}
