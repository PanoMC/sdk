import { base } from '$app/paths';
import { registeredPages } from './PluginManager.js';
import { canonicalizeRouteKey } from './RouteMatcher.js';

const isPanel = base === '/panel';

export const baseAPI = {
  isPanel,
  debug: false,
};

export const pageAPI = {
  page: {
    register(
      page = {
        path: '',
        component: Promise,
        systemLayout: String,
        restLayout: Boolean,
      },
    ) {
      registeredPages[canonicalizeRouteKey(page.path)] = page;
    },
    unregister(path = '') {
      delete registeredPages[canonicalizeRouteKey(path)];
    },
    isPluginPage: (path = '') => registeredPages[canonicalizeRouteKey(path)] !== undefined,
  },
};
