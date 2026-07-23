import ApiUtil, { buildQueryParams } from "$pano/lib/api.util.js";

const VIEWER_ID_STORAGE_KEY = "pano:post-viewer-id:v1";
const VIEW_CACHE_STORAGE_KEY = "pano:post-view-cache:v1";
const VIEW_CACHE_LIMIT = 300;

const VIEW_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

export const getPosts = async ({ page, categoryUrl, request, csrfToken }) => {
  const queryParams = buildQueryParams({ page, categoryUrl });

  return ApiUtil.get({
    path: `/api/posts${queryParams}`,
    request,
    csrfToken
  }).then((body) => {
    body.page = parseInt(page);

    return body;
  });
};

export const getPostDetail = async ({ url, request, csrfToken }) => {
  return ApiUtil.get({
    path: `/api/posts/${url}`,
    request,
    csrfToken
  }).then((body) => {
    body.url = url;

    return body;
  });
};

export const getPostPreview = async ({ id, request, csrfToken }) => {
  return ApiUtil.get({
    path: `/api/panel/posts/${id}/preview`,
    request,
    csrfToken
  }).then((body) => {
    body.id = parseInt(id);

    return body;
  });
};

const canUseLocalStorage = () => {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
};

const generateViewerId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 16)}`;
};

const getOrCreateViewerId = () => {
  if (!canUseLocalStorage()) return null;

  try {
    const currentValue = window.localStorage.getItem(VIEWER_ID_STORAGE_KEY);
    if (currentValue) return currentValue;

    const newValue = generateViewerId();
    window.localStorage.setItem(VIEWER_ID_STORAGE_KEY, newValue);
    return newValue;
  } catch (_error) {
    return null;
  }
};

const readViewCache = () => {
  if (!canUseLocalStorage()) return {};

  try {
    const rawCache = window.localStorage.getItem(VIEW_CACHE_STORAGE_KEY);
    if (!rawCache) return {};

    const parsedCache = JSON.parse(rawCache);
    return typeof parsedCache === "object" && parsedCache !== null ? parsedCache : {};
  } catch (_error) {
    return {};
  }
};

const writeViewCache = (cache) => {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.setItem(VIEW_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch (_error) {
  }
};

const cleanViewCache = (cache, now) => {
  const freshEntries = Object.entries(cache).filter(([, timestamp]) => {
    return Number.isFinite(timestamp) && now - timestamp <= VIEW_DEDUPE_WINDOW_MS;
  });

  freshEntries.sort((a, b) => b[1] - a[1]);

  return Object.fromEntries(freshEntries.slice(0, VIEW_CACHE_LIMIT));
};

const hasRecentlyTrackedView = (postUrl) => {
  const now = Date.now();
  const cache = cleanViewCache(readViewCache(), now);
  writeViewCache(cache);

  const lastTrackedAt = cache[postUrl];
  return Number.isFinite(lastTrackedAt) && now - lastTrackedAt < VIEW_DEDUPE_WINDOW_MS;
};

const markViewAsTracked = (postUrl) => {
  const now = Date.now();
  const cache = cleanViewCache(readViewCache(), now);
  cache[postUrl] = now;
  writeViewCache(cache);
};

export const trackPostView = async ({ url, csrfToken }) => {
  if (!url || typeof window === "undefined") {
    return { counted: false };
  }

  if (hasRecentlyTrackedView(url)) {
    return { counted: false };
  }

  const viewerId = getOrCreateViewerId();

  const headers = viewerId ? { "X-Post-Viewer-Id": viewerId } : undefined;

  return ApiUtil.post({
    path: `/api/posts/${encodeURIComponent(url)}/view`,
    body: {},
    headers,
    csrfToken
  })
    .then((body) => {
      if (body?.result === "ok") {
        markViewAsTracked(url);
      }

      return body;
    })
    .catch(() => {
      return { counted: false };
    });
};
