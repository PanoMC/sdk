<svelte:component
  this={data.View}
  {data}
  {session}
  {contentItems}
  {altMethods}
  {viewState}
  {usernameOrEmail}
  {password}
  {email}
  {passwordRepeat}
  {agreement}
  {newUsername}
  {linkCode}
  {loading}
  {error}
  {passwordVisible}
  {emailRequired}
  {emailVerificationSent}
  {autoVerifyDone}
  {usernameRequiredUserId}
  {onSubmit}
  {onVerifyLink}
  {onCompleteRegister}
  {onUsernameOrEmailFieldInput}
  {onRegisterEmailFieldInput}
  {onNewUsernameFieldInput} />

<script context="module">
  import { executeLifecycle, executeViewLoad, panoApiServer } from "$pano/lib/PluginAPI";
  import { resolveView } from "$pano/registry/index.js";

  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "LoginView",
      () => import("../views/LoginView.svelte"),
    );

    const { parent } = event;
    await parent();

    // Initialize login content
    panoApiServer.ui.auth.login.content.edit((items) => {
      items.push({ id: "login-form", priority: 100, hidden: false });
    });

    const lifecycleData = { error: null, event };
    await executeLifecycle("theme:login:load", lifecycleData, event);
    await executeViewLoad("login-content", event);
    await executeViewLoad("login-alt-methods", event);

    return { initialError: lifecycleData.error || null, pageTitle: "components.modals.login.title", View: await viewPromise };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { writable } from "svelte/store";
  import { format } from "date-fns";
  import * as locales from "date-fns/locale";

  import { afterNavigate, goto } from "$app/navigation";

  import { NETWORK_ERROR } from "$pano/lib/api.util";
  import { currentLanguage } from "$pano/lib/language.util";

  import { getCredentials, sendLogin, sendRegister, verifyLinkCode } from "$pano/lib/services/auth.js";
  import { show as showToast } from "$pano/lib/components/ToastContainer.svelte";

  import { stripIdentifierWhitespace } from "$pano/lib/loginInput.util.js";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";

  export let data;

  const viewState = writable("LOGIN"); // LOGIN, LINK_CODE, REGISTER, REGISTER_EMAIL, SET_USERNAME

  const usernameOrEmail = writable(""),
    password = writable("");
  const loading = writable(), error = writable();

  // Read initial error from lifecycle (plugin-injected)
  if (data?.initialError) {
    $error = data.initialError;
  }

  let _skipFirstNav = !!data?.initialError;

  const passwordVisible = writable(false);

  $: if ($session?.siteInfo?.isDemo && $usernameOrEmail === "demo") {
    $password = "123456";
    $passwordVisible = true;
  }

  // Register fields
  const linkCode = writable("");
  const email = writable("");
  const passwordRepeat = writable("");
  const agreement = writable(false);
  let registerToken = "";
  const autoVerifyDone = writable(false);
  const emailRequired = writable(false);
  const emailVerificationSent = writable(false);
  const newUsername = writable("");
  const usernameRequiredUserId = writable(null);

  const session = getContext("session");

  function onUsernameOrEmailFieldInput() {
    const c = stripIdentifierWhitespace($usernameOrEmail);
    if (c !== $usernameOrEmail) {
      $usernameOrEmail = c;
    }
    if (!$emailRequired && !($session?.siteInfo?.isDemo && $usernameOrEmail === "demo")) {
      $passwordVisible = false;
      $password = "";
    }
    $error = null;
  }

  function onRegisterEmailFieldInput() {
    const c = stripIdentifierWhitespace($email);
    if (c !== $email) {
      $email = c;
    }
    $error = null;
  }

  function onNewUsernameFieldInput() {
    const c = stripIdentifierWhitespace($newUsername);
    if (c !== $newUsername) {
      $newUsername = c;
    }
    $error = null;
  }

  afterNavigate(() => {
    if (_skipFirstNav) {
      _skipFirstNav = false;
      return;
    }
    $viewState = "LOGIN";
    $error = null;
    $autoVerifyDone = false;
    $linkCode = "";
    $passwordVisible = false;
    $emailRequired = false;
    $email = "";
    $emailVerificationSent = false;
    $password = "";
    $newUsername = "";
    $usernameRequiredUserId = null;
  });

  async function onVerifyLink() {
    if ($linkCode.length !== 6) return;
    $loading = true;
    $error = null;
    $autoVerifyDone = true;

    try {
      const body = await verifyLinkCode($usernameOrEmail, $linkCode);
      if (body.result === "ok") {
        registerToken = body.token;
        // Assuming backend returns username associated with code
        if (body.username) {
          $usernameOrEmail = body.username;
        }
        $viewState = "REGISTER";
      } else {
        if (body.error === "PLUGIN_DENIED_LOGIN" && body.reason) {
          $error = body.reason;
        } else {
          $error = body.result === "error" ? body.error : NETWORK_ERROR;
        }
      }
    } catch (err) {
      console.error(err);
      $error = NETWORK_ERROR;
    } finally {
      $loading = false;
    }
  }

  async function onCompleteRegister() {
    $loading = true;
    $error = null;

    // Check agreement if required
    // RegisterForm handles UI, but we need to check logic if we want client side validation or trust backend

    try {
      const body = await sendRegister({
        registerWithLinkToken: registerToken,
        email: $email,
        password: $password,
        passwordRepeat: $passwordRepeat,
        agreement: $agreement,
      });

      if (body.result !== "ok") {
        if (body.error === "INVALID_TOKEN") {
          $viewState = "LOGIN";
          $error = null;
          $autoVerifyDone = false;
          $linkCode = "";
          $loading = false;
          return;
        }
        $error = body.result === "error" ? body.error : NETWORK_ERROR;
        $loading = false;
        return;
      }

      if (body.login) {
        const csrfToken = body.csrfToken;
        const credsBody = await getCredentials(csrfToken);

        session.update((data) => {
          data.user = {
            ...Object.keys(credsBody)
              .filter((key) => !["result"].includes(key))
              .reduce((object, key) => {
                object[key] = credsBody[key];
                return object;
              }, {})
          };
          data.csrfToken = csrfToken;
          return data;
        });

        await showToast("successes.LOGIN_SUCCESSFUL");
        await goto("/");
        return;
      }

      if (body.emailVerificationRequired) {
        $viewState = "LOGIN";
        registerToken = "";
        $linkCode = "";
        $password = "";
        $passwordRepeat = "";
        $error = { key: "LOGIN_EMAIL_NOT_VERIFIED", props: { email: body.email ?? $email } };
        return;
      }

      await showToast("successes.REGISTER_SUCCESSFUL");

      const loginBody = await sendLogin({ usernameOrEmail: $usernameOrEmail, password: $password });
      if (loginBody.result !== "ok") {
        $error = loginBody.error;
        $loading = false;
        return;
      }

      const csrfToken = loginBody.csrfToken;
      const credsBody = await getCredentials(csrfToken);

      session.update((data) => {
        data.user = {
          ...Object.keys(credsBody)
            .filter((key) => !["result"].includes(key))
            .reduce((object, key) => {
              object[key] = credsBody[key];
              return object;
            }, {})
        };
        data.csrfToken = csrfToken;
        return data;
      });

      await goto("/");

    } catch (err) {
      console.error(err);
      $error = NETWORK_ERROR;
    } finally {
      $loading = false;
    }
  }

  async function onSubmit() {
    $error = null;
    $loading = true;

    await sendLogin({
      usernameOrEmail: $usernameOrEmail,
      password: $password,
      registerEmail: $emailRequired ? $email : undefined,
      newUsername: $viewState === "SET_USERNAME" ? $newUsername : undefined
    })
      .then(async (body) => {
        if (body.result !== "ok") {
          $loading = false;
          if (body.error === "LINK_CODE_REQUIRED") {
            $viewState = "LINK_CODE";
            $passwordVisible = false;
            $password = "";
            $error = null;
            return;
          }

          if (body.error === "LOGIN_EMAIL_NOT_VERIFIED") {
            if ($emailRequired) {
              $emailVerificationSent = true;
              $error = null;
              return;
            }
            $error = { key: "LOGIN_EMAIL_NOT_VERIFIED", props: { email: body.email } };
            return;
          }

          if (body.error === "REGISTER_EMAIL_REQUIRED") {
            $emailRequired = true;
            $passwordVisible = true;
            if ($session?.siteInfo?.isDemo && $usernameOrEmail === "demo") {
              $password = "123456";
            }
            $error = null;
            setTimeout(() => document.getElementById("email")?.focus(), 50);
            return;
          }

          if (body.error === "USERNAME_REQUIRED") {
            $usernameRequiredUserId = body.userId;
            $viewState = "SET_USERNAME";
            $error = null;
            setTimeout(() => document.getElementById("newUsername")?.focus(), 50);
            return;
          }

          if (body.error === "LOGIN_IS_INVALID" && !$passwordVisible) {
            $passwordVisible = true;
            if ($session?.siteInfo?.isDemo && $usernameOrEmail === "demo") {
              $password = "123456";
            }
            $error = null;
            setTimeout(() => document.getElementById("password")?.focus(), 50);
            return;
          }

          if (body.error === "PLUGIN_DENIED_LOGIN" && body.reason) {
            $error = body.reason;
            return;
          }

          $error = body.result === "error" ? body.error : NETWORK_ERROR;

          if (
            body.result === "error" &&
            body.error === "LOGIN_USER_IS_BANNED"
          ) {
            if (!body.until) {
              $error = { key: "LOGIN_USER_IS_BANNED_PERMANENTLY" };
              if (body.reason) {
                $error = {
                  key: "LOGIN_USER_IS_BANNED_PERMANENTLY_WITH_REASON",
                  props: { reason: `'${body.reason}'` }
                };
              }
            } else {
              const formattedUntil = format(
                new Date(body.until),
                "dd/MM/yyyy HH:mm",
                {
                  locale: locales[$currentLanguage.dateFnsCode]
                }
              );

              $error = {
                key: "LOGIN_USER_IS_BANNED_TEMPORARY",
                props: { untilTime: formattedUntil }
              };

              if (body.reason) {
                $error = {
                  key: "LOGIN_USER_IS_BANNED_TEMPORARY_WITH_REASON",
                  props: {
                    reason: `'${body.reason}'`,
                    untilTime: formattedUntil
                  }
                };
              }
            }
          }
          return;
        }

        const csrfToken = body.csrfToken;

        await getCredentials(csrfToken).then(async (body) => {
          session.update((data) => {
            data.user = {
              ...Object.keys(body)
                .filter((key) => !["result"].includes(key))
                .reduce((object, key) => {
                  object[key] = body[key];

                  return object;
                }, {})
            };

            data.csrfToken = csrfToken;

            return data;
          });

          await showToast("successes.LOGIN_SUCCESSFUL");

          await goto("/");

          $loading = false;
        });
      })
      .catch((err) => {
        console.log(err);
        $loading = false;
      });
  }

  const pageTitle = getContext("pageTitle");

  $: if ($viewState === "LOGIN") {
    $pageTitle = "components.modals.login.title";
  } else if ($viewState === "LINK_CODE") {
    $pageTitle = "components.modals.login.link-code.title";
  } else if ($viewState === "REGISTER") {
    $pageTitle = "components.modals.login.register-with-link.title";
  }

  onMount(() => {
    if ($session.siteInfo.isDemo) {
      $usernameOrEmail = "demo";
      $password = "123456";
      $passwordVisible = true;
    }

    if (!$session.siteInfo.hasRegisterAgreement) {
      $agreement = true;
    }
  });

  const contentItems = panoApiClient.ui.auth.login.content.get();
  const altMethods = panoApiClient.ui.auth.login.alternativeMethods.get();
</script>
