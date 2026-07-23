<svelte:component
  this={data.View}
  {data}
  {contentItems}
  {altMethods}
  {onSubmit}
  {loading}
  {error}
  {successMessage}
  {username}
  {email}
  {password}
  {passwordRepeat}
  {agreement} />

<script context="module">
  import { executeLifecycle, executeViewLoad, panoApiServer } from "$pano/lib/PluginAPI";
  import { resolveView } from "$pano/registry/index.js";

  export async function load(event) {
    // Resolved in load (not {#await} in markup): universal load data is not
    // serialized, so the component class can travel in it, and SSR renders the
    // view instead of an await-pending branch.
    const viewPromise = resolveView(
      "RegisterView",
      () => import("../views/RegisterView.svelte"),
    );

    const { parent } = event;
    await parent();

    // Initialize register content
    panoApiServer.ui.auth.register.content.edit((items) => {
      items.push({ id: "register-form", priority: 100, hidden: false });
    });

    const lifecycleData = { error: null, username: null, event };
    await executeLifecycle("theme:register:load", lifecycleData, event);
    await executeViewLoad("register-content", event);
    await executeViewLoad("register-alt-methods", event);

    return {
      initialError: lifecycleData.error || null,
      initialUsername: lifecycleData.username || null,
      pageTitle: "components.modals.register.title",
      View: await viewPromise
    };
  }
</script>

<script>
  import { getContext, onMount } from "svelte";
  import { writable } from "svelte/store";
  import { goto } from "$app/navigation";

  import { NETWORK_ERROR } from "$pano/lib/api.util";

  import PageTitle from "$pano/lib/components/PageTitle.svelte";
  import { show as showToast } from "$pano/lib/components/ToastContainer.svelte";

  import { sendRegister, getCredentials } from "$pano/lib/services/auth.js";
  import { panoApiClient } from "$pano/lib/PluginAPI.js";

  export let data;

  const session = getContext("session");

  const loading = writable();
  const error = writable();
  const successMessage = writable();
  const username = writable("");
  const email = writable("");
  const password = writable("");
  const passwordRepeat = writable("");

  // Read initial values from lifecycle (plugin-injected)
  if (data?.initialError) {
    error.set(data.initialError);
  }
  if (data?.initialUsername) {
    username.set(data.initialUsername);
  }

  const agreement = writable(!$session.siteInfo.hasRegisterAgreement ? true : false);

  async function onSubmit() {
    error.set(null);
    successMessage.set(null);
    loading.set(true);

    await sendRegister({
      username: $username,
      email: $email,
      password: $password,
      passwordRepeat: $passwordRepeat,
      agreement: $agreement,
      recaptcha: "",
    })
      .then(async (body) => {
        if (body.result === "ok") {
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
            loading.set(false);
            return;
          }

          successMessage.set("REGISTER_SUCCESSFUL");
          loading.set(false);
        } else {
          if (body.error === "PLUGIN_DENIED_LOGIN" && body.reason) {
            error.set(body.reason);
          } else {
            error.set(body.result === "error" ? body.error : NETWORK_ERROR);
          }
          loading.set(false);
        }
      })
      .catch(() => {
        loading.set(false);

        error.set(NETWORK_ERROR);
      });
  }

  const contentItems = panoApiClient.ui.auth.register.content.get();
  const altMethods = panoApiClient.ui.auth.register.alternativeMethods.get();
</script>
