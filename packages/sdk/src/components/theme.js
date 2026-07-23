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
