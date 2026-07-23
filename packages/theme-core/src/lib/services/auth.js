import ApiUtil from "$pano/lib/api.util";

export const sendLogout = async () => {
  return ApiUtil.post({
    path: "/api/auth/logout",
  });
};

export const sendLogin = async (body) => {
  return ApiUtil.post({
    path: "/api/auth/login",
    body,
  });
};

export const getCredentials = async (csrfToken) => {
  return ApiUtil.get({
    path: "/api/auth/credentials",
    csrfToken
  });
};

export const getCredentialsServerSide = async (token) => {
  return ApiUtil.get({ path: "/api/auth/credentials", token }).then((response) => {
    if (response.result !== "ok") {
      return null;
    }

    return Object.keys(response)
      .filter((key) => !["result"].includes(key))
      .reduce((object, key) => {
        object[key] = response[key];

        return object;
      }, {});
  });
};

export const sendRegister = async (body) => {
  return ApiUtil.post({
    path: "/api/auth/register",
    body,
  });
};

export const sendVerifyEmail = async (token) => {
  return ApiUtil.post({
    path: "/api/auth/verifyEmail",
    body: { token },
  });
};

export const sendVerifyNewEmail = async (token) => {
  return ApiUtil.post({
    path: "/api/auth/verifyNewEmail",
    body: { token },
  });
};

export const sendResetPassword = async (usernameOrEmail) => {
  return ApiUtil.post({
    path: "/api/auth/resetPassword",
    body: { usernameOrEmail },
  });
};


export const sendRenewPassword = async (
  newPassword,
  newPasswordRepeat,
  token
) => {
  return ApiUtil.post({
    path: "/api/auth/renewPassword",
    body: { newPassword, newPasswordRepeat, token },
  });
};

export const verifyLinkCode = async (username, code) => {
  return ApiUtil.post({
    path: "/api/auth/verifyLinkCode",
    body: { username, code },
  });
};

