<div class="card">
  <div class="card-body" data-fixture-page={name}>
    {#if name === 'hook'}
      {#if Hook}<Hook name="fixture:hook" />{:else}<span data-fixture="no-hook">Hook missing from context</span>{/if}
    {:else if name === 'toast'}
      <button class="btn btn-primary" onclick={showXssToast}>Toast</button>
    {:else}
      <span data-fixture="ready">{name}</span>
    {/if}
  </div>
</div>

<script module>
  const pages = {
    '/fixture/login-required': { name: 'login-required' },
    '/fixture/hook': { name: 'hook' },
    '/fixture/meta': {
      name: 'meta',
      meta: { description: 'Fixture   description', image: '/fixture.png', canonical: '/fixture/meta', jsonLd: { '@type': 'Thing', name: 'Fixture' } }
    },
    '/profile/fixture': { name: 'profile', sidebar: 'profile' },
    '/fixture/sidebar-empty': { name: 'sidebar-empty', sidebar: 'plugin:fixture-empty' },
    '/fixture/sidebar-one': { name: 'sidebar-one', sidebar: 'plugin:fixture' },
    '/fixture/toast': { name: 'toast' },
    '/fixture/title': { name: 'title', pageTitle: { title: 'buttons.save', raw: true, hidden: true } }
  };

  // The returned keys pageTitle / sidebar / meta are lifted to page.data by the host.
  export async function load(event) {
    return pages[event.url.pathname] ?? { name: 'unknown' };
  }
</script>

<script>
  import { getPanoContext } from '@panomc/sdk';

  let { name } = $props();
  const { context } = getPanoContext();
  const Hook = context.components?.Hook;

  // The value must render as text: the host escapes it before the locale string is interpolated.
  function showXssToast() {
    context.utils.toast.showSuccess('plugins.tc9-fixture.toast', { value: '<img src=x onerror=alert(1)>' });
  }
</script>
