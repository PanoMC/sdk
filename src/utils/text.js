import { getPanoContext } from '../internal/index.js';

const panoContext = getPanoContext();
const textStuff = panoContext.context.utils.text;

const copy = textStuff.copy;

export { copy };