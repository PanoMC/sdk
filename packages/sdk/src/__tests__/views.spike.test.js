import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'svelte/server';
import * as workspaceSvelte from 'svelte';

import { buildSpike } from '../../../../test-fixtures/proxy-spike/build.js';
import { getPanoContext, setPanoContext } from '../internal/index.js';

/**
 * TC-22: the riskiest assumption of the view proxy (doc 01 section 0 and 4, doc 03 section 4.4).
 *
 * On the server the plugin bundle has no `external`, so it carries its own Svelte server runtime (and its own SDK copy);
 * the theme renders with the workspace Svelte. Only `globalThis.__PANO_CONTEXT__` is shared. Four things must hold:
 *  1. an override inside a default page and a default inside an override land in the right place, markers balanced;
 *  2. both read the session through the SDK pano context;
 *  3. a theme-copy wrapper (FallbackScope) with setContext / getContext around a plugin-copy component works, and a
 *     nested call sees its own context;
 *  4. on the client (one Svelte, happy-dom) mount and hydrate give the same DOM.
 */

/** @type {{ plugin: any, theme: any, files: any }} */
let spike;

const dom = new Window();

/** Parses markup the way a browser would, in an isolated happy-dom document. */
function parse(html) {
  const doc = new Window().document;

  doc.body.innerHTML = html;

  return doc.body;
}

/** Svelte opens a block with `<!--[-->`, `<!--[!-->`, `<!--[0-->` ... and closes it with `<!--]-->`. */
function markerBalance(html) {
  const open = (html.match(/<!--\[[^\]>]*-->/g) ?? []).length;
  const close = (html.match(/<!--\]-->/g) ?? []).length;

  return { open, close };
}

const withoutComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/** Canonical markup: no comments, attributes sorted (the server and the client serialise attributes in another order). */
function canonical(html) {
  const walk = (node) => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';

    const attrs = [...node.attributes]
      .map((a) => `${a.name}="${a.value}"`)
      .sort()
      .join(' ');

    return `<${node.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>${[...node.childNodes].map(walk).join('')}</${node.tagName.toLowerCase()}>`;
  };

  return [...parse(html).childNodes].map(walk).join('');
}

const setSession = (user) =>
  setPanoContext({
    page: {
      subscribe(fn) {
        fn({ data: { session: user === null ? undefined : { user } } });

        return () => {};
      },
    },
  });

/** Renders `Root` (a theme component) around the plugin's `Page` with the given `context.views`. */
function renderPage(Root, views, user = 'alice') {
  setSession(user);
  setPanoContext({ views });

  return render(Root, { props: { Page: spike.plugin.Page } });
}

beforeAll(async () => {
  spike = { files: await buildSpike() };
  spike.plugin = await import(spike.files.pluginServer);
  spike.theme = await import(spike.files.themeServer);
});

afterEach(() => {
  const { context } = getPanoContext();

  delete context.views;
  delete context.page;
});

describe('two Svelte copies (the premise)', () => {
  test('the plugin bundle carries its own Svelte server runtime', () => {
    expect(spike.plugin.pluginGetContext).toBeFunction();
    expect(spike.plugin.pluginGetContext).not.toBe(workspaceSvelte.getContext);
  });

  test('the plugin copy cannot read a context the theme copy set (getContext in a plugin view)', () => {
    const { body } = render(spike.theme.ProbeRoot, { props: { Probe: spike.plugin.Probe } });

    // Whatever the plugin copy does (throws outside a component, or finds nothing), it must not see 'theme-root'.
    expect(body).toContain('class="probe"');
    expect(body).not.toContain('ctx:theme-root');
    expect(body).toMatch(/ctx:none|threw:/);
  });
});

describe('1. override inside a default page, default inside an override', () => {
  test('without an override everything renders the plugin defaults, in order, markers balanced', () => {
    const { body } = renderPage(spike.theme.Root, spike.theme.createViews({}));
    const root = parse(body);

    expect(root.querySelectorAll('.child-override').length).toBe(0);
    expect(root.querySelector('section.page > h1').textContent).toBe('Home');
    expect(root.querySelector('section.page > .child-default .label').textContent).toBe('one');
    // default Badge inside the default Child, and the page's own Badge after it
    expect(root.querySelector('.child-default .badge').textContent).toBe('inside-default-child');
    expect(root.querySelector('section.page > .badge').textContent).toBe('page-badge');

    const order = [...root.querySelectorAll('section.page > *')].map((n) => n.className || n.tagName.toLowerCase());
    expect(order).toEqual(['h1', 'page-user', 'child-default', 'badge', 'logged']);

    const { open, close } = markerBalance(body);
    expect(open).toBeGreaterThan(0);
    expect(open).toBe(close);
  });

  test('an override of Child replaces it inside the default page and keeps a default Badge inside itself', () => {
    const views = spike.theme.createViews({
      overrides: { 'spike:Child': spike.theme.ChildOverride },
      defaults: { 'spike:Badge': spike.plugin.Badge },
    });
    const { body } = renderPage(spike.theme.Root, views);
    const root = parse(body);

    expect(root.querySelectorAll('.child-default').length).toBe(0);
    expect(root.querySelectorAll('.child-override').length).toBe(1);
    expect(root.querySelector('section.page > .child-override .label').textContent).toBe('one');
    // the default Badge inside the override is the plugin's, rendered by the plugin copy
    expect(root.querySelector('.child-override > .badge').textContent).toBe('inside-override');
    // the page's own Badge is still a sibling after the override, not swallowed by it
    expect(root.querySelector('section.page > .badge').textContent).toBe('page-badge');

    const order = [...root.querySelectorAll('section.page > *')].map((n) => n.className || n.tagName.toLowerCase());
    expect(order).toEqual(['h1', 'page-user', 'child-override', 'badge', 'logged']);

    const { open, close } = markerBalance(body);
    expect(open).toBe(close);
  });

  test('the override of a leaf (Badge) replaces it both in the page and inside the default Child', () => {
    const Marked = ($$renderer, props) => $$renderer.push(`<u class="badge-override">${props.text}</u>`);
    const { body } = renderPage(spike.theme.Root, spike.theme.createViews({ overrides: { 'spike:Badge': Marked } }));
    const root = parse(body);

    expect(root.querySelectorAll('.badge').length).toBe(0);
    expect(root.querySelector('.child-default > .badge-override').textContent).toBe('inside-default-child');
    expect(root.querySelector('section.page > .badge-override').textContent).toBe('page-badge');
    expect(markerBalance(body).open).toBe(markerBalance(body).close);
  });
});

describe('2. the session through the SDK pano context', () => {
  test('default view, default child and theme override all read the same user', () => {
    const views = spike.theme.createViews({
      overrides: { 'spike:Child': spike.theme.ChildOverride },
      defaults: { 'spike:Badge': spike.plugin.Badge },
    });
    const override = parse(renderPage(spike.theme.Root, views, 'alice').body);

    expect(override.querySelector('.page-user').textContent).toBe('page:alice');
    expect(override.querySelector('.theme-user').textContent).toBe('theme-session:alice');
    expect(override.querySelector('.logged').textContent).toBe('in');

    const plain = parse(renderPage(spike.theme.Root, spike.theme.createViews({}), 'alice').body);

    expect(plain.querySelector('.page-user').textContent).toBe('page:alice');
    expect(plain.querySelector('.child-user').textContent).toBe('session:alice');
  });

  test('a guest is a guest everywhere, and the user changes between two renders without a leak', () => {
    const views = spike.theme.createViews({
      overrides: { 'spike:Child': spike.theme.ChildOverride },
      defaults: { 'spike:Badge': spike.plugin.Badge },
    });
    const guest = parse(renderPage(spike.theme.Root, views, null).body);

    expect(guest.querySelector('.page-user').textContent).toBe('page:guest');
    expect(guest.querySelector('.theme-user').textContent).toBe('theme-session:guest');
    expect(guest.querySelector('.logged').textContent).toBe('out');

    const bob = parse(renderPage(spike.theme.Root, views, 'bob').body);

    expect(bob.querySelector('.page-user').textContent).toBe('page:bob');
    expect(bob.querySelector('.theme-user').textContent).toBe('theme-session:bob');
  });

  test('without context.views (panel, widget build) the default renders', () => {
    setSession('alice');

    const { body } = render(spike.theme.RootPlain, { props: { Page: spike.plugin.Page } });
    const root = parse(body);

    expect(root.querySelector('.child-default')).not.toBeNull();
    expect(root.querySelector('.page-user').textContent).toBe('page:alice');
  });
});

describe('3. a theme-copy wrapper with setContext / getContext around plugin-copy components', () => {
  const makeViews = (log) =>
    spike.theme.createViews({
      overrides: { 'spike:Child': spike.theme.ChildOverride },
      defaults: { 'spike:Badge': spike.plugin.Badge },
      fallback: true,
      log,
    });

  test('FallbackScope pattern renders without throwing and nested wrappers see their own context', () => {
    const log = [];
    let body;

    expect(() => {
      ({ body } = renderPage(spike.theme.RootScoped, makeViews(log)));
    }).not.toThrow();

    // No wrap call lost its frame: getContext worked in every one of them.
    expect(log.length).toBe(3);
    expect(log.every((entry) => entry.threw === false)).toBe(true);

    // order of render: Child (override) in the page, then the Badge inside the override, then the page's Badge
    expect(log.map((e) => [e.name, e.source, e.inside, e.mode])).toEqual([
      // the page itself sits in a 'spike' fallback scope, so the override gets a stop scope
      ['spike:Child', 'override', 'spike', 'stop'],
      // inside the stop scope the context is null, so the default Badge opens a fresh fallback scope
      ['spike:Badge', 'default', null, 'fallback'],
      // back in the page's own scope: a default of the same plugin renders unwrapped (doc 03 step 4)
      ['spike:Badge', 'default', 'spike', null],
    ]);

    const root = parse(body);
    const scope = root.querySelector('main > .pano-fb[data-pano-fb="spike"]');

    expect(scope).not.toBeNull();
    expect(scope.querySelector('section.page > .pano-fb-stop > .child-override')).not.toBeNull();
    expect(scope.querySelector('.pano-fb-stop > .child-override > .pano-fb[data-pano-fb="spike"] > .badge').textContent).toBe(
      'inside-override',
    );
    // the page's Badge is a direct child of the page, no wrapper
    expect(scope.querySelector('section.page > .badge').textContent).toBe('page-badge');
    expect(markerBalance(body).open).toBe(markerBalance(body).close);
  });

  test('every wrapper is balanced: a second render in the same process gives the same HTML', () => {
    const a = renderPage(spike.theme.RootScoped, makeViews([])).body;
    const b = renderPage(spike.theme.RootScoped, makeViews([])).body;

    expect(b).toBe(a);
  });

  test('a root that is a plain function (no compiled theme component) still renders correctly', () => {
    const log = [];
    let body;

    setSession('alice');
    setPanoContext({ views: makeViews(log) });

    const Bare = ($$renderer, props) => spike.plugin.Page($$renderer, props);

    {
      ({ body } = render(Bare, { props: { title: 'Home' } }));
    }

    expect(log.length).toBe(3);

    const root = parse(body);

    expect(root.querySelector('.child-override')).not.toBeNull();
    expect(root.querySelector('.badge')).not.toBeNull();
    expect(markerBalance(body).open).toBe(markerBalance(body).close);
  });

  test('a compiled theme root that never calls setContext: the frames come from the renderer, getContext does not throw', () => {
    const log = [];

    const { body } = renderPage(spike.theme.RootPlain, makeViews(log));

    expect(body).toContain('child-override');
    // `$$renderer.component` belongs to the theme copy, so even a component of the plugin copy pushes a theme-copy frame.
    expect(log.length).toBe(3);
    expect(log.every((entry) => entry.threw === false)).toBe(true);
    // no scope above the page: the first wrap sees nothing at all, the override gets no stop scope
    expect(log[0]).toMatchObject({ name: 'spike:Child', source: 'override', inside: undefined, mode: null });
  });

  test('wrap called outside any render (a preload or a test) must not throw: getContext is guarded', () => {
    const log = [];
    const views = makeViews(log);
    const Leaf = () => {};

    expect(views.wrap('spike:Badge', Leaf, 'default')).toBeFunction();
    expect(log[0].threw).toBe(true);
  });
});

describe('4. client: mount and hydrate give the same DOM (one Svelte, happy-dom)', () => {
  const GLOBALS = [
    'window',
    'document',
    'navigator',
    'Node',
    'Element',
    'HTMLElement',
    'HTMLTemplateElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLTextAreaElement',
    'HTMLFormElement',
    'HTMLImageElement',
    'HTMLIFrameElement',
    'HTMLMediaElement',
    'ShadowRoot',
    'Text',
    'Comment',
    'DocumentFragment',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'KeyboardEvent',
    'InputEvent',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'customElements',
  ];
  const saved = new Map();

  beforeAll(() => {
    for (const key of GLOBALS) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

      const value = key === 'window' ? dom : dom[key];

      if (value === undefined) continue;

      Object.defineProperty(globalThis, key, {
        value: typeof value === 'function' && !/^[A-Z]/.test(key) ? value.bind(dom) : value,
        configurable: true,
        writable: true,
      });
    }
  });

  afterAll(() => {
    for (const key of GLOBALS) {
      const was = saved.get(key);

      if (was) Object.defineProperty(globalThis, key, was);
      else delete globalThis[key];
    }
  });

  test('hydrating the server HTML reuses the nodes, warns nothing, and ends up equal to a fresh mount', async () => {
    const client = await import(spike.files.client);
    const options = {
      overrides: { 'spike:Child': client.ChildOverride },
      defaults: { 'spike:Badge': client.Badge },
      fallback: true,
    };

    // server HTML from the two-copy server render, same configuration
    const serverViews = spike.theme.createViews({
      overrides: { 'spike:Child': spike.theme.ChildOverride },
      defaults: { 'spike:Badge': spike.plugin.Badge },
      fallback: true,
    });
    const { body } = renderPage(spike.theme.RootScoped, serverViews);

    // fresh mount
    setPanoContext({ views: client.createViews(options) });

    const mountTarget = dom.document.createElement('div');

    dom.document.body.appendChild(mountTarget);

    const mounted = client.mount(client.RootScoped, { target: mountTarget, props: { Page: client.Page } });

    await Promise.resolve();

    // hydration
    const hydrateTarget = dom.document.createElement('div');

    dom.document.body.appendChild(hydrateTarget);
    hydrateTarget.innerHTML = body;

    const before = hydrateTarget.querySelector('.child-override');
    const warnings = [];
    const originalWarn = console.warn;
    const originalError = console.error;

    console.warn = (...args) => warnings.push(args.join(' '));
    console.error = (...args) => warnings.push(args.join(' '));

    let hydrated;

    try {
      hydrated = client.hydrate(client.RootScoped, { target: hydrateTarget, props: { Page: client.Page } });
      await Promise.resolve();
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }

    expect(warnings).toEqual([]);
    // nodes were adopted, not rebuilt
    expect(hydrateTarget.querySelector('.child-override')).toBe(before);

    const mountedHtml = canonical(mountTarget.innerHTML);
    const hydratedHtml = canonical(hydrateTarget.innerHTML);

    expect(mountedHtml).toContain('child-override');
    expect(hydratedHtml).toBe(mountedHtml);
    // and the server HTML itself is the same markup
    expect(canonical(body)).toBe(mountedHtml);

    client.unmount(mounted);
    client.unmount(hydrated);
  });

  test('the same holds with the plain default views (no override, no fallback)', async () => {
    const client = await import(spike.files.client);
    const { body } = renderPage(spike.theme.Root, spike.theme.createViews({}));

    setPanoContext({ views: client.createViews({}) });

    const mountTarget = dom.document.createElement('div');
    const hydrateTarget = dom.document.createElement('div');

    dom.document.body.append(mountTarget, hydrateTarget);
    hydrateTarget.innerHTML = body;

    const warnings = [];
    const originalWarn = console.warn;

    console.warn = (...args) => warnings.push(args.join(' '));

    let mounted;
    let hydrated;

    try {
      mounted = client.mount(client.Root, { target: mountTarget, props: { Page: client.Page } });
      hydrated = client.hydrate(client.Root, { target: hydrateTarget, props: { Page: client.Page } });

      await Promise.resolve();
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toEqual([]);

    const mountedHtml = canonical(mountTarget.innerHTML);

    expect(mountedHtml).toContain('child-default');
    expect(canonical(hydrateTarget.innerHTML)).toBe(mountedHtml);
    expect(canonical(body)).toBe(mountedHtml);

    client.unmount(mounted);
    client.unmount(hydrated);
  });
});
