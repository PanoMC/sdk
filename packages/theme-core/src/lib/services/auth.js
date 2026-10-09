import ApiUtil from "$pano/lib/api.util";

export const sendLogout = async () => {
  return ApiUtil.post({
    path: "/auth/logout",
  });
};

export const sendLogin = async (body) => {
  return ApiUtil.post({
    path: "/auth/login",
    body,
  });
};

export const getCredentials = async (csrfToken) => {
  return ApiUtil.get({
    path: "/auth/credentials",
    csrfToken
  });
};

export const getCredentialsServerSide = async (token) => {
  return ApiUtil.get({ path: "/auth/credentials", token }).then((response) => {
    if (!!response.error) {
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
    path: "/auth/register",
    body,
  });
};

export const sendVerifyEmail = async (token) => {
  return ApiUtil.post({
    path: "/auth/verify-email",
    body: { token },
  });
};

export const sendVerifyNewEmail = async (token) => {
  return ApiUtil.post({
    path: "/auth/verify-new-email",
    body: { token },
  });
};

export const sendResetPassword = async (usernameOrEmail) => {
  return ApiUtil.post({
    path: "/auth/reset-password",
    body: { usernameOrEmail },
  });
};


export const sendRenewPassword = async (
  newPassword,
  newPasswordRepeat,
  token
) => {
  return ApiUtil.post({
    path: "/auth/renew-password",
    body: { newPassword, newPasswordRepeat, token },
  });
};

export const verifyLinkCode = async (username, code) => {
  return ApiUtil.post({
    path: "/auth/verify-link-code",
    body: { username, code },
  });
};

