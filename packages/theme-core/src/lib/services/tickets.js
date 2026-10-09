import ApiUtil, { buildQueryParams } from "../api.util.js";
import { readPage } from "../pageShape.js";

export const getTickets = async ({ page, pageSize, pageType, categoryUrl, request, csrfToken }) => {
  const queryParams = buildQueryParams({ page, pageSize, pageType, categoryUrl });

  return ApiUtil.get({
    path: `/tickets${queryParams}`,
    request,
    csrfToken
  }).then((body) => {
    const result = readPage(body);

    if (result.failed) {
      return result.body;
    }

    return {
      ...result.rest,
      tickets: result.items,
      ticketCount: result.count,
      page: parseInt(page),
      totalPages: result.totalPages,
      pageType
    };
  });
};

export const getTicketCategories = async ({ page, pageSize, request, csrfToken }) => {
  const queryParams = buildQueryParams({ page, pageSize });

  return ApiUtil.get({
    path: `/ticket-categories${queryParams}`,
    request,
    csrfToken
  }).then((body) => {
    const result = readPage(body);

    if (result.failed) {
      return result.body;
    }

    return {
      ...result.rest,
      categories: result.items,
      page: parseInt(page)
    };
  });
};

export const updateTicket = async ({ id, status, request, csrfToken }) => {
  return ApiUtil.put({
    path: `/tickets/${id}`,
    body: {
      status,
    },
    request,
    csrfToken
  });
};

export const createTicket = async ({
  title,
  message,
  categoryId,
  request,
                                     csrfToken
}) => {
  return ApiUtil.post({
    path: `/tickets`,
    body: {
      title,
      message,
      categoryId,
    },
    request,
    csrfToken
  });
};

export const getTicketDetail = async ({ id, request, csrfToken }) => {
  return ApiUtil.get({
    path: `/tickets/${id}`,
    request,
    csrfToken
  });
};

export const loadMoreTicketMessages = async ({
  id,
  lastMessageId,
  request,
                                               csrfToken
}) => {
  return ApiUtil.get({
    path: `/tickets/${id}/messages?lastMessageId=${lastMessageId}`,
    request,
    csrfToken
  });
};

export const sendTicketMessage = async ({
  ticketId,
  message,
  request,
                                          csrfToken
}) => {
  return ApiUtil.post({
    path: `/tickets/${ticketId}/messages`,
    body: {
      message,
    },
    request,
    csrfToken
  });
};
