import ApiUtil from "$pano/lib/api.util.js";

export const getProfile = async ({ request }) => {
  return ApiUtil.get({
    path: `/api/profile`,
    request,
  });
};

export const getPlayerProfile = async ({ request, username }) => {
  return ApiUtil.get({
    path: `/api/profiles/${username}`,
    request,
  });
};

export const sendResetPassword = async () => {
  return ApiUtil.post({
    path: "/api/profile/resetPassword",
  });
};

export const sendChangeEmail = async (currentPassword, newEmail) => {
  return ApiUtil.post({
    path: "/api/profile/changeEmail",
    body: {
      currentPassword,
      newEmail,
    },
  });
};

export const sendUpdateProfile = async (body) => {
  return ApiUtil.put({
    path: "/api/profile", body
  });
};