// `@panomc/sdk/variables` outside a theme: live bindings filled from the page configuration; the rest are inert.
import { getConfig, onConfigure } from './config.js';

export let API_URL = `${getConfig().apiBase}/api`;
export let UI_URL = getConfig().siteUrl;
export let PANEL_URL = '';
export let SETUP_URL = '';
export let PANO_WEBSITE_URL = 'https://panomc.com';
export let PANO_WEBSITE_API_URL = 'https://api.panomc.com';
export const PRERELEASE = false;
export const COOKIE_PREFIX = '';
export const CSRF_TOKEN_COOKIE_NAME = '';
export const JWT_COOKIE_NAME = '';
export const CSRF_HEADER = 'X-CSRF-Token';

onConfigure((config) => {
  API_URL = `${config.apiBase}/api`;
  UI_URL = config.siteUrl;
});

export const updateApiUrl = (url) => {
  API_URL = url;
};
export const updatePanoWebsiteUrl = (url) => {
  PANO_WEBSITE_URL = url;
};
export const updatePanoWebsiteApiUrl = (url) => {
  PANO_WEBSITE_API_URL = url;
};
