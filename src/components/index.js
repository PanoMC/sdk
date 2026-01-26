import { getPanoContext } from "../internal/index.js";

const panoContext = getPanoContext();
const components = panoContext.context.components;

export const PageActions = components.PageActions;
export const PageLoader = components.PageLoader;
export const PageNavItem = components.PageNavItem;
export const PageNav = components.PageNav;
export const Pagination = components.Pagination;
export const PageLoading = components.PageLoading;
export const Toast = components.Toast;
export const CardFilters = components.CardFilters;
export const CardFiltersItem = components.CardFiltersItem;
export const CardHeader = components.CardHeader;
export const CardMenu = components.CardMenu;
export const CardMenuItem = components.CardMenuItem;
export const Date = components.Date;
export const NoContent = components.NoContent;
export const Editor = components.Editor;
export const DragAndDropZone = components.DragAndDropZone;
export const PageTitle = components.PageTitle;
export const PlayerHead = components.PlayerHead;
