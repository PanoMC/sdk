import { getPanoContext } from '../internal/index.js';

const panoContext = getPanoContext();
const tooltipStuff = panoContext.context.utils.tooltip;

const tooltip = tooltipStuff.tooltip;

export { tooltip };

export default tooltip;
