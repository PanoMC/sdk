import { getPanoContext } from '../internal/index.js';

const panoContext = getPanoContext();
const apiStuff = panoContext.context.utils.api;

const ApiUtil = apiStuff.ApiUtil;

const NETWORK_ERROR = apiStuff.NETWORK_ERROR;
const networkErrorBody = apiStuff.networkErrorBody;
const buildQueryParams = apiStuff.buildQueryParams;

export { ApiUtil, NETWORK_ERROR, networkErrorBody, buildQueryParams };

export default ApiUtil;
