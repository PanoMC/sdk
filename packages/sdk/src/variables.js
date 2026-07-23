import { getPanoContext } from './internal/index.js';

const panoContext = getPanoContext();
const variableStuff = panoContext.context.variables;

const API_URL = variableStuff.API_URL;
const UI_URL = variableStuff.UI_URL;
const PANEL_URL = variableStuff.PANEL_URL;
const SETUP_URL = variableStuff.SETUP_URL;
const PANO_WEBSITE_URL = variableStuff.PANO_WEBSITE_URL;
const PANO_WEBSITE_API_URL = variableStuff.PANO_WEBSITE_API_URL;
const PRERELEASE = variableStuff.PRERELEASE;
const COOKIE_PREFIX = variableStuff.COOKIE_PREFIX;
const CSRF_TOKEN_COOKIE_NAME = variableStuff.CSRF_TOKEN_COOKIE_NAME;
const JWT_COOKIE_NAME = variableStuff.JWT_COOKIE_NAME;
const CSRF_HEADER = variableStuff.CSRF_HEADER;
const updateApiUrl = variableStuff.updateApiUrl;
const updatePanoWebsiteUrl = variableStuff.updatePanoWebsiteUrl;
const updatePanoWebsiteApiUrl = variableStuff.updatePanoWebsiteApiUrl;

export {
  API_URL,
  UI_URL,
  PANEL_URL,
  SETUP_URL,
  PANO_WEBSITE_URL,
  PANO_WEBSITE_API_URL,
  PRERELEASE,
  COOKIE_PREFIX,
  CSRF_TOKEN_COOKIE_NAME,
  JWT_COOKIE_NAME,
  CSRF_HEADER,
  updateApiUrl,
  updatePanoWebsiteUrl,
  updatePanoWebsiteApiUrl,
};
