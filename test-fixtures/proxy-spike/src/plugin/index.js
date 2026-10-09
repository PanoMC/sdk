import { getContext } from 'svelte';
import Page from './Page.svelte';
import Probe from './Probe.svelte';
import Child from './Child.proxy.js';
import Badge from './Badge.proxy.js';

// The plugin's server entry: pages and the proxies the registry hands out as defaults.
export { Page, Probe, Child, Badge };

/** The plugin copy's getContext, so a test can prove the two copies are different instances. */
export const pluginGetContext = getContext;
