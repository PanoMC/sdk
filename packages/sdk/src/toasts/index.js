import { getPanoContext } from '../internal/index.js';

const panoContext = getPanoContext();
const toastStuff = panoContext.context.utils.toast;

const showToast = toastStuff.show;
const limitTitle = toastStuff.limitTitle;

export { showToast, limitTitle };
