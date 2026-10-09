// The three Svelte lifecycle functions this package calls, behind one file. In a widget bundle `svelte` is external (the shared
// runtime); tests replace this file with the browser build of Svelte, because under Bun the default `svelte` is the server build.
export { mount, unmount, onMount } from 'svelte';
