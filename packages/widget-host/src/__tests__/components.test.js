// W1: the Svelte copies of the theme components render without $lib / $app.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { installBrowserEnv, settle, uninstallBrowserEnv } from './env.js';

let c, mount, unmount, configure;

beforeAll(async () => {
  await installBrowserEnv();
  c = await import('../components/index.js');
  ({ mount, unmount } = await import('../svelte-runtime.js'));
  ({ configure } = await import('../config.js'));
  configure({ apiBase: 'https://pano.test', locale: 'en-US' });
});

afterAll(() => uninstallBrowserEnv());

function render(Component, props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const instance = mount(Component, { target, props });
  return { target, destroy: () => unmount(instance) };
}

describe('components', () => {
  test('NoContent shows the text and the icon class', () => {
    const { target, destroy } = render(c.NoContent, { text: 'Nothing here', icon: 'fa-solid fa-ghost' });
    expect(target.querySelector('p').textContent).toBe('Nothing here');
    expect(target.querySelector('span').className).toBe('fa-solid fa-ghost');
    destroy();
  });

  test('Pagination renders the pages and marks the current one', async () => {
    const { target, destroy } = render(c.Pagination, { page: 2, totalPage: 3 });
    expect(target.querySelectorAll('li.page-item')).toHaveLength(5);
    expect(target.querySelector('li.active').textContent.trim()).toBe('2');
    destroy();
  });

  test('Toast maps the variant to a class', () => {
    const { target, destroy } = render(c.Toast, { id: 4, variant: 'danger' });
    const el = target.querySelector('#appToast4');
    expect(el.className).toContain('text-danger');
    destroy();
  });

  test('PageTitle: a string title, subtitle', () => {
    const { target, destroy } = render(c.PageTitle, { title: 'Hello', subtitle: 'World' });
    expect(target.querySelector('h1').textContent.trim()).toBe('Hello');
    expect(target.querySelector('p').textContent.trim()).toBe('World');
    destroy();
  });

  test('PageActions renders only the sides it was given', () => {
    const { target, destroy } = render(c.PageActions, { leftClasses: 'x' });
    expect(target.querySelectorAll('.row > div')).toHaveLength(1);
    destroy();
  });

  test('Date formats an epoch string; PlayerHead points at the site picture', async () => {
    const date = render(c.Date, { time: String(Date.UTC(2026, 0, 15, 12)) });
    expect(date.target.querySelector('span').textContent.trim()).toContain('2026');
    date.destroy();

    const head = render(c.PlayerHead, { username: 'Steve', lastActivityTime: Date.now(), banned: false });
    await settle(5);
    expect(head.target.querySelector('img').getAttribute('src')).toBe('https://pano.test/api/profile/picture/Steve');
    head.destroy();
  });

  test('PluginBlock and PluginSlot render nothing', () => {
    for (const C of [c.PluginBlock, c.PluginSlot]) {
      const { target, destroy } = render(C, { id: 'market:NavCart' });
      expect(target.innerHTML.trim()).toBe('');
      destroy();
    }
  });
});
