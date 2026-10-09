import { createViewProxy } from '@panomc/sdk/views';
import Default from './Child.svelte';

// What the plugin build writes for every view file: importers get this module, never the .svelte file directly.
export default createViewProxy('spike:Child', Default);
