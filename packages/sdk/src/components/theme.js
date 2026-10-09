import { getPanoContext } from "../internal/index.js";

const panoContext = getPanoContext();
const components = panoContext.context.components;

export const PlayerHead = components.PlayerHead;
export const NoContent = components.NoContent;
export const Date = components.Date;
export const Toast = components.Toast;

export const PageTitle = components.PageTitle;
export const PageActions = components.PageActions;
export const Pagination = components.Pagination;

// Views of other plugins (doc 01 sections 5 and 6): `<PluginBlock id="market:ProductGrid" limit={8} />` places a
// registered view with its own data, `<PluginSlot id="market:checkout:payment" />` opens a slot for injected views.
export const PluginBlock = components.PluginBlock;
export const PluginSlot = components.PluginSlot;
