<!--
  @view ProfileView
  Controller: $pano/lib/pages/profile/ProfilePage.svelte
  Props:
    data.registerDate   number — epoch timestamp of the user's registration date
    data.lastLoginDate  number — epoch timestamp of the user's last login
    contentItems   store<Array> — plugin-extendable list of profile page content blocks
    cardRowItems   store<Array> — plugin-extendable rows of the profile card table
  Override from a theme:
    theme.config.js → views: { ProfileView: () => import("./src/views/ProfileView.svelte") }
-->
<!-- Statistics -->

<div class="vstack gap-3">
  {#each $contentItems as item (item.id)}
    {#if item.id === "profile-card"}
      <div class="card">
        <CardHeader>
          <div slot="left">{$_("pages.profile.title")}</div>
        </CardHeader>
        <table class="table">
          <tbody>
            {#each $cardRowItems as row (row.id)}
              {#if row.id === "register-date"}
                <tr>
                  <td>{$_("pages.profile.register-date")}</td>
                  <td><Date time={data.registerDate} /></td>
                </tr>
              {:else if row.id === "last-login"}
                <tr>
                  <td>{$_("pages.profile.last-login")}</td>
                  <td><Date time={data.lastLoginDate} relativeFormat="true" /></td>
                </tr>
              {:else if row.props && row.props.label}
                <!-- Custom plugin row -->
                <tr>
                  <td>{row.props.label && row.props.label.includes(".") ? $_(row.props.label) : row.props.label}</td>
                  <td>
                    {#if row.component}
                      <ViewComponent component={row.component} data={row.props.data} />
                    {:else}
                      {row.props.value || ""}
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {:else if item.component}
      <!-- External plugin component -->
      <ViewComponent component={item.component} {data} />
    {/if}
  {/each}
</div>

<script>
  import { _ } from "svelte-i18n";

  import Date from "$pano/lib/components/Date.svelte";
  import CardHeader from "$pano/lib/components/CardHeader.svelte";
  import ViewComponent from "$pano/lib/components/ViewComponent.svelte";

  export let data;
  export let contentItems;
  export let cardRowItems;
</script>
