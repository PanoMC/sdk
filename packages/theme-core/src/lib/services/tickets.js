import ApiUtil, { buildQueryParams } from "../api.util.js";

export const getTickets = async ({ page, pageType, categoryUrl, request, csrfToken }) => {
  const queryParams = buildQueryParams({ page, pageType, categoryUrl });

  return ApiUtil.get({
    path: `/api/tickets${queryParams}`,
    request,
    csrfToken
  }).then((body) => {
    body.page = parseInt(page);
    body.pageType = pageType;

    return body;
  });
};

export const getTicketCategories = async ({ page, request, csrfToken }) => {
  return ApiUtil.get({
    path: `/api/ticket/categories?page=${page}`,
    request,
    csrfToken
  }).then((body) => {
    body.page = parseInt(page);

    return body;
  });
};

export const updateTicket = async ({ id, status, request, csrfToken }) => {
  return ApiUtil.put({
    path: `/api/tickets/${id}`,
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
    path: `/api/tickets`,
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
    path: `/api/tickets/${id}`,
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
    path: `/api/tickets/${id}/messages?lastMessageId=${lastMessageId}`,
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
    path: `/api/tickets/${ticketId}/messages`,
    body: {
      message,
    },
    request,
    csrfToken
  });
};
