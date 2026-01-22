import { getPanoContext } from '../internal/index.js';

const panoContext = getPanoContext();
const authStuff = panoContext.context.utils.auth;

const hasPermission = authStuff.hasPermission;

export { hasPermission };
