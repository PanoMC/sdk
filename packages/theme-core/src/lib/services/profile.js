import ApiUtil from "$pano/lib/api.util.js";

export const getProfile = async ({ request }) => {
  return ApiUtil.get({
    path: `/profile`,
    request,
  });
};

export const getPlayerProfile = async ({ request, username }) => {
  return ApiUtil.get({
    path: `/profiles/${username}`,
    request,
  });
};

export const sendResetPassword = async () => {
  return ApiUtil.post({
    path: "/profile/reset-password",
  });
};

export const sendChangeEmail = async (currentPassword, newEmail) => {
  return ApiUtil.post({
    path: "/profile/change-email",
    body: {
      currentPassword,
      newEmail,
    },
  });
};

export const sendUpdateProfile = async (body) => {
  return ApiUtil.put({
    path: "/profile", body
  });
};