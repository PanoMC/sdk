// E2E-19 host integration checks against the isolated market E2E instance with the host UIs of the local checkouts (`e2e-instance.sh start --ui external:<theme>,<panel>`)
// and this fixture plugin (build.sh; the instance is started with MARKET_E2E_FAKE_JAR=<tc9-fixture-local-build.jar>, which replaces the fake gateway jar):
//
//   TC-9   items 1 to 7 (15 section 10): the TC-9 fixture pages on vanilla-theme (item 2 asserts, on the adapter-node production build, that a host component rendered from a plugin bundle emits markup on the server)
//   PUI-2  items 1 to 5: the player-detail tab, permission gate, catch-all, @panomc/sdk/utils/auth, plugin notification
//   P-4.3  mail with locale / text / Reply-To / PDF attachment into a local SMTP sink
//   P-5.3  GET /api/panel/notifications: pluginId for a plugin row, null for a core row
//
// Run from the market checkout after `eval "$(scripts/e2e-instance.sh start ...)"`:   bun <this file> [filter ...]
// Ends with `E2E19-SUMMARY executed=N failed=M`; exits non-zero on a failure. Nothing here is shipped.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startSink } from './smtp-sink.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const umbrella = path.resolve(here, '../../../..');
const marketDir =
  process.env.E2E19_MARKET_DIR ||
  path.join(umbrella, 'pano-web-platform/plugins/pano-plugin-market');
const lib = (name) => import(pathToFileURL(path.join(marketDir, 'e2e-browser/lib', name)).href);

const { loadEnv } = await lib('env.mjs');
const { Api, must } = await lib('api.mjs');
const { adminSession, newBuyer, grantUserNode, product, category, BUYER_PASSWORD } = await lib('bootstrap.mjs');
const { launch, newContext } = await lib('browser.mjs');
const { hydrated, assert, assertEqual } = await lib('ui.mjs');

const PLUGIN_ID = 'tc9-fixture';
const FIXTURE_NODE = 'pano.plugin.tc9-fixture.view.fixture';
const PANEL_ACCESS = 'pano.panel.access.panel';
const MANAGE_PLAYERS = 'pano.panel.manage.players';
const filters = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const env = loadEnv();
if (!env.themeUrl || !env.panelUrl)
  throw new Error(
    'MARKET_E2E_THEME_URL / MARKET_E2E_PANEL_URL are not set: start the instance with --ui external:<theme port>,<panel port>',
  );

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const notes = [];
const note = (text) => {
  notes.push(text);
  console.log(`NOTE ${text}`);
};

/** The vite dev ports bounce the browser to the Pano instance (the SDK's dev-only same-host redirect); that navigation is answered with 204 so the dev page stays. */
async function blockDevBounce(pc) {
  await pc.context.route(`${env.url}/**`, (route) =>
    route.request().isNavigationRequest() ? route.fulfill({ status: 204 }) : route.continue(),
  );
}

async function htmlOf(url, headers = {}) {
  const res = await fetch(url, { redirect: 'manual', headers: { Accept: 'text/html', ...headers } });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
}

const count = (text, re) => (text.match(re) ?? []).length;

let admin;
const staff = {};

async function ensureAdmin() {
  if (admin) return admin;
  admin = await adminSession(env);
  must(
    await admin.multipart('PUT', '/api/panel/settings', { requireEmailVerification: 'false' }),
    'settings',
  );
  await admin.post('/api/panel/dismissWhatsNew', { version: '1' });
  return admin;
}

/** A registered account the sign-in form accepts (the e-mail marked verified by the owner). */
async function verifiedAccount(label) {
  const a = await ensureAdmin();
  const account = await newBuyer(env, a, label);
  must(
    await a.put(`/api/panel/players/${account.userId}`, {
      username: account.username,
      email: `${account.username}@example.com`,
      newPassword: '',
      newPasswordRepeat: '',
      isEmailVerified: true,
      canCreateTicket: true,
      localeCode: 'en-US',
      clearPassword: false,
    }),
    `verify ${account.username}`,
  );
  return account;
}

async function staffAccount(label, nodes) {
  const a = await ensureAdmin();
  const account = await newBuyer(env, a, label);
  for (const n of nodes) await grantUserNode(a, account.userId, n);
  await account.post('/api/panel/dismissWhatsNew', { version: '1' });
  return account;
}

const checks = [];
const check = (id, title, run) => checks.push({ id, title, run });

// ---------------------------------------------------------------------------------------------------------------- P-5.3

check('P-5.3', 'panel notifications return pluginId for a plugin row and null for a core row', async () => {
  const a = await ensureAdmin();
  must(await a.post('/api/panel/tc9-fixture/notify?href=%2Ffixture%2Ftarget'), 'fixture notify');

  const list = must(await a.get('/api/panel/notifications'), 'notifications').json;
  const rows = list.notifications ?? [];
  const plugin = rows.find((n) => n.type === 'FIXTURE');
  const core = rows.find((n) => n.type === 'PANO_UPDATE_FOUND');

  assert(plugin, `no FIXTURE row in ${JSON.stringify(rows.map((n) => n.type))}`);
  assert(core, `no PANO_UPDATE_FOUND row in ${JSON.stringify(rows.map((n) => n.type))}`);
  assertEqual(plugin.pluginId, PLUGIN_ID, 'pluginId of the plugin row');
  assert('pluginId' in core, 'the core row carries a pluginId key');
  assertEqual(core.pluginId, null, 'pluginId of the core row');
  assertEqual(plugin.details?.href, '/fixture/target', 'the plugin row keeps its details.href');

  // the quick list (navbar dropdown) emits the same key
  must(await a.post('/api/panel/tc9-fixture/notify?href=%2Ffixture%2Ftarget'), 'fixture notify 2');
  const quick = must(await a.get('/api/panel/notifications/quick'), 'quick notifications').json;
  const qrows = quick.notifications ?? [];
  const qp = qrows.find((n) => n.type === 'FIXTURE');
  const qc = qrows.find((n) => n.type === 'PANO_UPDATE_FOUND');
  assert(qp && qc, `quick list lacks a row: ${JSON.stringify(qrows.map((n) => n.type))}`);
  assertEqual(qp.pluginId, PLUGIN_ID, 'quick: pluginId of the plugin row');
  assertEqual(qc.pluginId, null, 'quick: pluginId of the core row');
});

// ---------------------------------------------------------------------------------------------------------------- P-4.3

check('P-4.3', 'mail with locale, text, Reply-To and a PDF arrives in the local SMTP sink; CR/LF in Reply-To are stripped; mail off => DISABLED', async () => {
  const a = await ensureAdmin();
  const sink = await startSink();
  const emailSettings = (enabled) =>
    JSON.stringify({
      enabled,
      hostname: '127.0.0.1',
      port: sink.port,
      ssl: false,
      starttls: 'DISABLED',
      authMethods: '',
      username: '',
      password: '',
      sender: 'shop@example.com',
    });
  const disabled = JSON.stringify({
    enabled: false,
    hostname: '',
    port: 587,
    ssl: false,
    starttls: 'DISABLED',
    authMethods: '',
    username: '',
    password: '',
    sender: '',
  });

  try {
    // mail still off: the call reports DISABLED and sends nothing
    must(await a.multipart('PUT', '/api/panel/settings', { email: disabled }), 'mail off');
    const off = must(
      await a.post('/api/panel/tc9-fixture/mail?to=guest%40example.com&locale=tr'),
      'mail while off',
    ).json;
    assertEqual(off.result, 'DISABLED', 'MailResult while the platform mail switch is off');
    assertEqual(sink.messages.length, 0, 'messages in the sink while mail is off');

    must(await a.multipart('PUT', '/api/panel/settings', { email: emailSettings(true) }), 'mail on');
    const before = sink.messages.length; // the settings save may send its own test mail through the sink

    // 1. locale tr without an explicit subject: the platform's Turkish translation; text part; Reply-To; PDF
    const text = 'Siparişiniz alındı: düz metin bölümü';
    const first = must(
      await a.post(
        `/api/panel/tc9-fixture/mail?to=guest%40example.com&locale=tr&replyTo=${encodeURIComponent('support@example.com')}&text=${encodeURIComponent(text)}`,
      ),
      'mail 1',
    ).json;
    assertEqual(first.result, 'SENT', 'MailResult');
    assertEqual(sink.messages.length, before + 1, 'one new message');
    const m1 = sink.parse(before + 1);
    const trLocale = JSON.parse(
      fs.readFileSync(path.join(umbrella, 'pano-web-platform/Pano/src/main/resources/locales/platform/tr.json'), 'utf8'),
    );
    const trSubject = trLocale.mail?.['password-updated']?.subject;
    assert(trSubject, 'tr.json has mail.password-updated.subject');
    const enLocale = JSON.parse(
      fs.readFileSync(path.join(umbrella, 'pano-web-platform/Pano/src/main/resources/locales/platform/en-US.json'), 'utf8'),
    );
    const enSubject = enLocale.mail?.['password-updated']?.subject;
    assert(m1.subject && m1.subject !== enSubject, `the subject is not the English one: ${m1.subject}`);
    const trTail = trSubject.replace(/^.*\}\}/, '');
    assert(trTail.trim().length > 3 && m1.subject.endsWith(trTail), `the subject is the Turkish translation (${JSON.stringify(trSubject)}), got ${JSON.stringify(m1.subject)}`);
    assertEqual(JSON.stringify(m1.to), JSON.stringify(['guest@example.com']), 'To header');
    assertEqual(m1.envelope.to[0], 'guest@example.com', 'envelope recipient');
    assertEqual(JSON.stringify(m1.replyTo), JSON.stringify(['support@example.com']), 'Reply-To header');
    const plain = m1.parts.find((p) => p.contentType === 'text/plain');
    assert(plain, `a text/plain part exists: ${JSON.stringify(m1.parts.map((p) => p.contentType))}`);
    assertEqual(plain.text.trim(), text, 'text part (UTF-8)');
    assert(m1.parts.some((p) => p.contentType === 'text/html'), 'an HTML part exists next to the text');
    assertEqual(m1.attachments.length, 1, 'one attachment');
    assertEqual(m1.attachments[0].name, 'invoice.pdf', 'attachment name');
    assertEqual(m1.attachments[0].contentType, 'application/pdf', 'attachment content type');
    assertEqual(m1.attachments[0].size, first.attachmentBytes, 'attachment size (bytes intact)');
    assertEqual(m1.attachments[0].sha256, first.attachmentSha256, 'attachment sha256 (bytes intact)');
    assertEqual(m1.attachments[0].head, '255044462d312e34', 'attachment starts with %PDF-1.4');

    // 2. an explicit non-ASCII subject is encoded and round-trips
    const subject = 'Sipariş #42 ✓ ödendi';
    const second = must(
      await a.post(
        `/api/panel/tc9-fixture/mail?to=guest%40example.com&locale=tr&subject=${encodeURIComponent(subject)}&replyTo=${encodeURIComponent('a@b.co')}`,
      ),
      'mail 2',
    ).json;
    assertEqual(second.result, 'SENT', 'MailResult (explicit subject)');
    const m2 = sink.parse(before + 2);
    assertEqual(m2.subject, subject, 'explicit subject round-trips through the header encoding');

    // 3. CR / LF in replyTo are stripped: an injected header never appears, a value that is an address after the strip is kept
    must(
      await a.post(
        `/api/panel/tc9-fixture/mail?to=guest%40example.com&locale=tr&subject=inj&replyTo=${encodeURIComponent('reply@example.com\r\nBcc: evil@example.com')}`,
      ),
      'mail 3',
    );
    const m3 = sink.parse(before + 3);
    assert(!m3.headerNames.some((h) => h.toLowerCase() === 'bcc'), `no injected Bcc header: ${JSON.stringify(m3.headerNames)}`);
    assert(!sink.raw(before + 3).toString('latin1').includes('evil@example.com'), 'the injected address is nowhere in the message');
    assertEqual(m3.replyTo, null, 'an injected value that is no address after the strip sets no Reply-To');
    must(
      await a.post(
        `/api/panel/tc9-fixture/mail?to=guest%40example.com&locale=tr&subject=strip&replyTo=${encodeURIComponent('reply@exam\r\nple.com')}`,
      ),
      'mail 4',
    );
    const m4 = sink.parse(before + 4);
    assertEqual(JSON.stringify(m4.replyTo), JSON.stringify(['reply@example.com']), 'CR/LF stripped from an otherwise valid Reply-To');
    assert(
      !/\r\nReply-To:[^\r\n]*\r\n[ \t]*ple\.com/i.test(sink.raw(before + 4).toString('latin1')),
      'no folded continuation of the Reply-To header',
    );
  } finally {
    await a.multipart('PUT', '/api/panel/settings', { email: disabled }).catch(() => {});
    await sink.close();
  }
});

check('P-4.3b', 'seam MK-141 / MK-142: a market order mail (bank transfer instructions, then the paid confirmation with the invoice PDF) goes through the real MailManager and SMTP', async () => {
  const a = await ensureAdmin();
  const sink = await startSink();
  const disabled = JSON.stringify({ enabled: false, hostname: '', port: 587, ssl: false, starttls: 'DISABLED', authMethods: '', username: '', password: '', sender: '' });
  const before = must(await a.get('/api/panel/market/settings'), 'read market settings').json;
  const prior = before.settings ?? before;
  const changes = {
    testMode: false,
    currency: 'EUR',
    statsCurrency: 'EUR',
    vatPercent: 20,
    showVatInPrice: true,
    allowGuestCheckout: true,
    orderExpiryMinutes: 60,
    checkoutRateLimitPerMinute: 100000,
    quoteRateLimitPerMinute: 100000,
    invoiceEnabled: true,
    sendEmailAfterPurchase: true,
    storeTimeZone: 'UTC',
    storeEnabled: true,
    minimumOrderAmount: 0,
    mailReplyTo: 'support@example.com'
  };
  const restore = {};
  for (const key of Object.keys(changes)) if (key in prior) restore[key] = prior[key];

  try {
    must(await a.post('/api/panel/market/settings', changes), 'market settings');
    must(
      await a.multipart('PUT', '/api/panel/settings', {
        email: JSON.stringify({ enabled: true, hostname: '127.0.0.1', port: sink.port, ssl: false, starttls: 'DISABLED', authMethods: '', username: '', password: '', sender: 'shop@example.com' })
      }),
      'mail on'
    );
    must(
      await a.post('/api/panel/market/payment-methods/bank-transfer', {
        settings: {
          accounts: JSON.stringify([{ bank: 'E2E Bank', holder: 'E2E Store', iban: 'DE89370400440532013000', currency: 'EUR' }]),
          instructions: 'Transfer the exact amount.'
        }
      }),
      'configure bank transfer'
    );
    must(await a.post('/api/panel/market/payment-methods/bank-transfer/toggle', { enabled: true }), 'enable bank transfer');

    const cat = await category(a, 'MailSeam');
    const item = await product(a, 'Mail Seam Rank', { price: '10.00', categoryId: cat.id });
    const buyer = await newBuyer(env, a, 'mseam');
    const mark = sink.messages.length;
    const placed = must(
      await buyer.post('/api/market/checkout', { items: [{ productId: item.id, quantity: 1 }], paymentMethodId: 'bank-transfer' }, { 'Idempotency-Key': crypto.randomUUID() }),
      'checkout'
    ).json;
    const publicId = placed.order.publicId;
    const number = (await buyer.get(`/api/market/orders/${publicId}`)).json?.order?.number ?? placed.order.number;

    const waitMail = async (what, predicate, timeout = 120000) => {
      const deadline = Date.now() + timeout;
      for (;;) {
        for (let n = mark + 1; n <= sink.messages.length; n++) {
          const parsed = sink.parse(n);
          if (predicate(parsed)) return parsed;
        }
        if (Date.now() > deadline) throw new Error(`no ${what} in the sink after ${timeout / 1000}s (${sink.messages.length - mark} message(s): ${[...Array(sink.messages.length - mark).keys()].map((i) => sink.parse(mark + 1 + i).subject).join(' | ')})`);
        await sleep(1000);
      }
    };
    const mine = (m) => (m.to ?? []).some((t) => t.includes(buyer.username));

    // 1. the order's first mail(s): addressed to the buyer, Reply-To from the market setting, text + HTML, subject set
    const first = await waitMail('mail to the buyer', mine);
    assert(first.subject && first.subject.length > 2, `a subject: ${JSON.stringify(first.subject)}`);
    assertEqual(JSON.stringify(first.replyTo), JSON.stringify(['support@example.com']), 'Reply-To from the market setting mailReplyTo');
    assert(first.parts.some((p) => p.contentType === 'text/plain' && p.text.trim().length > 0), 'a non-empty text part');
    assert(first.parts.some((p) => p.contentType === 'text/html'), 'an HTML part');
    assertEqual(first.envelope.to[0], `${buyer.username}@example.com`, 'envelope recipient is the buyer address');

    // 2. paid by the owner (bank transfer cannot be paid by the buyer): the confirmation carries the invoice PDF
    must(await a.put(`/api/panel/market/orders/${number}/status`, { status: 'COMPLETED' }), 'mark the order paid');
    const confirmed = await waitMail('mail with an invoice PDF', (m) => mine(m) && m.attachments.length > 0);
    assertEqual(confirmed.attachments.length, 1, 'one attachment');
    assertEqual(confirmed.attachments[0].contentType, 'application/pdf', 'attachment content type');
    assert(confirmed.attachments[0].name?.toLowerCase().endsWith('.pdf'), `attachment name: ${confirmed.attachments[0].name}`);
    assert(confirmed.attachments[0].size > 500, `a real PDF (size ${confirmed.attachments[0].size})`);
    assert(confirmed.attachments[0].head.startsWith('255044462d'), `the attachment bytes start with %PDF-: ${confirmed.attachments[0].head}`);
    assertEqual(JSON.stringify(confirmed.replyTo), JSON.stringify(['support@example.com']), 'Reply-To on the confirmation too');
    note(`P-4.3b: market mails received through the real MailManager: "${first.subject}" and "${confirmed.subject}" (invoice ${confirmed.attachments[0].name}, ${confirmed.attachments[0].size} bytes)`);
  } finally {
    await a.post('/api/panel/market/settings', restore).catch(() => {});
    await a.multipart('PUT', '/api/panel/settings', { email: disabled }).catch(() => {});
    await sink.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------- TC-9

const TC9_PATHS = {
  loginRequired: '/fixture/login-required',
  hook: '/fixture/hook',
  meta: '/fixture/meta',
  profile: '/profile/fixture',
  sidebarEmpty: '/fixture/sidebar-empty',
  sidebarOne: '/fixture/sidebar-one',
  toast: '/fixture/toast',
  title: '/fixture/title',
};

check('TC-9.1', 'a guest opening a loginRequired plugin page is redirected to /login?redirect=..., after login the page opens', async () => {
  const target = TC9_PATHS.loginRequired;
  const raw = await htmlOf(`${env.themeUrl}${target}`);
  assert([302, 303, 307].includes(raw.status), `guest gets a redirect, got ${raw.status}`);
  assertEqual(
    raw.location,
    `/login?redirect=${encodeURIComponent(target)}`,
    'the Location of the redirect',
  );

  const account = await verifiedAccount('tc91');
  const pc = await newContext(globalThis.__browser, { locale: 'en-US' });
  await blockDevBounce(pc);

  try {
    const page = await pc.page();
    await page.goto(`${env.themeUrl}${target}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await hydrated(page);
    assertEqual(
      new URL(page.url()).pathname + new URL(page.url()).search,
      `/login?redirect=${encodeURIComponent(target)}`,
      'the guest ends on the login page with the return target',
    );
    await page.locator('#usernameOrEmail').fill(account.username);
    await page.locator('button[type="submit"]').click();
    await page.locator('#password').fill(BUYER_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((url) => url.pathname === target, { timeout: 60000 });
    await page.locator('[data-fixture-page="login-required"]').waitFor({ timeout: 60000 });
    // the sign-in form's first step (the account name) is answered 422 by the host on purpose; nothing else may be logged
    const own = pc.errors.filter((e) => !/\/login\?.*status of 422/.test(e));
    assertEqual(own.length, 0, `console errors besides the form's 422: ${own.join(' | ')}`);
  } finally {
    await pc.close();
  }
});

/**
 * The production host: the adapter-node build of a private copy of vanilla-theme (`build-theme-prod.sh`), started on a free port against the instance's API and
 * stopped through the exact child process. TC-9 item 2 needs it: the vite dev server resolves Svelte once for host and plugin, the production server loads the
 * plugin's server bundle separately (15 section 4.7, the "own Svelte copy" risk).
 */
const THEME_BUILD = process.env.E2E19_THEME_BUILD || path.join(umbrella, '.worktrees/e2e19-ui/vanilla-theme/build');

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startProdTheme() {
  assert(
    fs.existsSync(path.join(THEME_BUILD, 'index.js')),
    `no production theme build at ${THEME_BUILD}: run build-theme-prod.sh first (or set E2E19_THEME_BUILD to an adapter-node build directory)`,
  );
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(THEME_BUILD, 'index.js')], {
    cwd: path.dirname(THEME_BUILD),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), API_URL: `${env.url}/api`, PANO_WEBSITE_API_URL: 'http://127.0.0.1:9/' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120000;

  for (;;) {
    if (child.exitCode !== null) throw new Error(`the production theme exited early (${child.exitCode}): ${log.slice(-800)}`);

    try {
      if ((await fetch(`${url}/_app/version.json`)).ok) break;
    } catch {
      // not listening yet
    }

    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error(`the production theme did not answer within 120 s: ${log.slice(-800)}`);
    }

    await sleep(500);
  }

  return { url, log: () => log, stop: () => child.kill('SIGTERM') };
}

check('TC-9.2', 'the host Hook from the context renders inside the plugin page client-side; the SSR rendering is proven on the production build', async () => {
  const target = TC9_PATHS.hook;
  const ssr = await htmlOf(`${env.themeUrl}${target}`);
  assertEqual(ssr.status, 200, 'the page answers 200');
  const ssrHasPage = ssr.text.includes('data-fixture-page="hook"');

  const pc = await newContext(globalThis.__browser, { locale: 'en-US' });
  await blockDevBounce(pc);
  const hydration = [];

  try {
    const page = await pc.page();
    page.on('console', (m) => {
      if (/hydrat/i.test(m.text())) hydration.push(`${m.type()}: ${m.text().slice(0, 200)}`);
    });
    await page.goto(`${env.themeUrl}${target}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await hydrated(page);
    await page.locator('[data-fixture-page="hook"]').waitFor({ timeout: 60000 });
    // client side: the context carries Hook, so the "Hook missing" fallback never shows, and the registered hook component renders
    assertEqual(await page.locator('[data-fixture="no-hook"]').count(), 0, 'the Hook-missing fallback is absent on the client');
    await page.locator('[data-fixture="hook-probe"]').waitFor({ timeout: 30000 });
    await page.locator('[data-fixture="hook-probe-ssr"]').waitFor({ timeout: 30000 });
    assertEqual(hydration.length, 0, `no hydration warning: ${hydration.join(' | ')}`);
    pc.expectNoErrors('TC-9.2');
  } finally {
    await pc.close();
  }

  // The dev server above only shows that the plugin page renders. The proof is on the production build: the host `Hook` emits markup on the server only for a hook
  // whose component is a resolved module (the thunk of `fixture:hook` is resolved in a client effect), so the page also registers `fixture:hook-ssr` that way.
  const prod = await startProdTheme();
  let verdict;

  try {
    const res = await htmlOf(`${prod.url}${target}`);
    const html = res.text;
    const container = /<div[^>]*class="hook-view-container[ "][^>]*hookName="fixture:hook-ssr"/i.test(html) || /<div[^>]*hookName="fixture:hook-ssr"[^>]*class="hook-view-container[ "]/i.test(html);
    const probe = html.includes('data-fixture="hook-probe-ssr"');
    const pageThere = html.includes('data-fixture-page="hook"');
    const fallback = html.includes('data-fixture="no-hook"');
    const doc = html.includes('</footer>') && html.includes('</html>');
    const thunkProbe = html.includes('data-fixture="hook-probe"');

    assertEqual(res.status, 200, `production server: ${target} answers 200 (server log: ${prod.log().slice(-400)})`);
    assert(pageThere, 'production server HTML contains the plugin page');
    assert(!fallback, 'production server HTML has no "Hook missing" fallback');
    assert(doc, 'production server HTML is the full document');
    assert(
      container,
      `production server HTML contains the markup the host Hook emitted (div.hook-view-container with hookName="fixture:hook-ssr"), server log: ${prod.log().slice(-400)}`,
    );
    assert(probe, 'production server HTML contains the hook component rendered inside the host Hook (data-fixture="hook-probe-ssr")');
    // the same hook as a viewComponent thunk is resolved on the client only: its content is NOT in the server HTML (recorded, not asserted as a goal)
    verdict = `PROVEN on the adapter-node production build: the host Hook (from getPanoContext().context.components) called from the plugin's server bundle emits its own markup (div.hook-view-container, hookName attribute) and the hook component inside it in the server HTML, no fallback; hydration clean in the browser (dev server). A hook registered with a viewComponent thunk renders its content on the client only (in the server HTML: ${thunkProbe}).`;
  } finally {
    prod.stop();
  }

  note(`TC-9 item 2 (SSR rendering of a host component from a plugin bundle): ${verdict}`);
  assert(ssrHasPage, 'the plugin page is part of the dev server HTML');
});

check('TC-9.3', 'a page with meta serves exactly one description, og:image, canonical and one JSON-LD', async () => {
  const { status, text } = await htmlOf(`${env.themeUrl}${TC9_PATHS.meta}`);
  assertEqual(status, 200, 'status');
  assertEqual(count(text, /<meta\s+name="description"/g), 1, 'description meta tags');
  assert(/<meta\s+name="description"\s+content="Fixture description"/.test(text), 'description is the collapsed text');
  assertEqual(count(text, /<meta\s+property="og:image"/g), 1, 'og:image meta tags');
  assertEqual(count(text, /<link\s+rel="canonical"/g), 1, 'canonical links');
  assertEqual(count(text, /<script\s+type="application\/ld\+json"/g), 1, 'JSON-LD scripts');
  const og = text.match(/<meta\s+property="og:image"\s+content="([^"]*)"/)?.[1];
  assert(og && /^https?:\/\//.test(og) && og.endsWith('/fixture.png'), `og:image is made absolute: ${og}`);
  const canonical = text.match(/<link\s+rel="canonical"\s+href="([^"]*)"/)?.[1];
  assert(canonical && canonical.endsWith('/fixture/meta'), `canonical: ${canonical}`);
  const ld = text.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert(ld && JSON.parse(ld).name === 'Fixture', `JSON-LD parses: ${ld}`);
});

check('TC-9.4', 'sidebar "profile" on /profile/fixture shows the profile card and nav with the Fixture item active', async () => {
  const account = await verifiedAccount('tc94');
  const pc = await newContext(globalThis.__browser, { locale: 'en-US', cookies: account.playwrightCookies() });
  await blockDevBounce(pc);

  try {
    const page = await pc.page();
    await page.goto(`${env.themeUrl}${TC9_PATHS.profile}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await hydrated(page);
    await page.locator('[data-fixture-page="profile"]').waitFor({ timeout: 60000 });
    const items = await page.locator('.list-group-item').evaluateAll((els) =>
      els.map((e) => ({ text: e.textContent.trim(), active: e.classList.contains('active'), href: e.getAttribute('href') })),
    );
    const fixture = items.filter((i) => i.text === 'Fixture');
    assertEqual(fixture.length, 1, `one Fixture nav item in ${JSON.stringify(items)}`);
    assert(fixture[0].active, 'the Fixture item is active');
    assertEqual(fixture[0].href, '/profile/fixture', 'the Fixture item href');
    assert(items.length >= 3, `built-in profile items are present next to Fixture: ${JSON.stringify(items.map((i) => i.text))}`);
    assertEqual(items.filter((i) => i.active).length, 1, 'only the Fixture item is active');
    const card = await page.getByText(account.username, { exact: false }).count();
    assert(card > 0, 'the profile card shows the user name');
    pc.expectNoErrors('TC-9.4');
  } finally {
    await pc.close();
  }
});

check('TC-9.5', 'sidebar "plugin:fixture-empty" with zero items is full width, "plugin:fixture" with one item is col-lg-8 + aside', async () => {
  const pc = await newContext(globalThis.__browser, { locale: 'en-US' });
  await blockDevBounce(pc);

  try {
    const page = await pc.page();
    await page.goto(`${env.themeUrl}${TC9_PATHS.sidebarEmpty}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await hydrated(page);
    await page.locator('[data-fixture-page="sidebar-empty"]').waitFor({ timeout: 60000 });
    assertEqual(await page.locator('.col-lg-8').count(), 0, 'no col-lg-8 with zero sidebar items');
    assertEqual(await page.locator('aside').count(), 0, 'no aside with zero sidebar items');
    assertEqual(await page.locator('[data-fixture="sidebar-item"]').count(), 0, 'no fixture sidebar item');

    await page.goto(`${env.themeUrl}${TC9_PATHS.sidebarOne}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await hydrated(page);
    await page.locator('[data-fixture-page="sidebar-one"]').waitFor({ timeout: 60000 });
    assertEqual(await page.locator('.col-lg-8').count(), 1, 'one col-lg-8 content column with one sidebar item');
    assertEqual(await page.locator('.col-lg-8 [data-fixture-page="sidebar-one"]').count(), 1, 'the page content sits in the col-lg-8 column');
    assertEqual(await page.locator('aside [data-fixture="sidebar-item"]').count(), 1, 'the sidebar item sits in an aside');
    pc.expectNoErrors('TC-9.5');

    // the same holds for the server render
    const ssrEmpty = await htmlOf(`${env.themeUrl}${TC9_PATHS.sidebarEmpty}`);
    const ssrOne = await htmlOf(`${env.themeUrl}${TC9_PATHS.sidebarOne}`);
    assertEqual(count(ssrEmpty.text, /col-lg-8/g), 0, 'SSR zero items: no col-lg-8');
    assert(ssrOne.text.includes('col-lg-8') && ssrOne.text.includes('data-fixture="sidebar-item"'), 'SSR one item: col-lg-8 and the item');
  } finally {
    await pc.close();
  }
});

check('TC-9.6', 'a toast value with markup shows as text and runs nothing', async () => {
  const pc = await newContext(globalThis.__browser, { locale: 'en-US' });
  await blockDevBounce(pc);

  try {
    const page = await pc.page();
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      d.dismiss().catch(() => {});
    });
    await page.goto(`${env.themeUrl}${TC9_PATHS.toast}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await hydrated(page);
    await page.locator('[data-fixture-page="toast"]').waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: 'Toast' }).click();
    const toast = page.locator('.toast', { hasText: 'Value:' }).first();
    await toast.waitFor({ timeout: 30000 });
    const text = (await toast.innerText()).trim();
    assert(text.includes('<img src=x onerror=alert(1)>'), `the toast shows the value as text: ${JSON.stringify(text)}`);
    assertEqual(await toast.locator('img').count(), 0, 'no <img> element inside the toast');
    await sleep(1000);
    assertEqual(dialogs.length, 0, `no alert ran: ${JSON.stringify(dialogs)}`);
    assertEqual(await page.locator('img[src="x"]').count(), 0, 'no <img src=x> anywhere on the page');
    pc.expectNoErrors('TC-9.6');
  } finally {
    await pc.close();
  }
});

check('TC-9.7', 'pageTitle { title: "buttons.save", raw: true, hidden: true }: <title> starts with buttons.save and there is no <h1>', async () => {
  const ssr = await htmlOf(`${env.themeUrl}${TC9_PATHS.title}`);
  assertEqual(ssr.status, 200, 'status');
  const title = ssr.text.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
  assert(title.startsWith('buttons.save'), `SSR <title> starts with the raw key: ${JSON.stringify(title)}`);

  const pc = await newContext(globalThis.__browser, { locale: 'en-US' });
  await blockDevBounce(pc);

  try {
    const page = await pc.page();
    await page.goto(`${env.themeUrl}${TC9_PATHS.title}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await hydrated(page);
    await page.locator('[data-fixture-page="title"]').waitFor({ timeout: 60000 });
    assert((await page.title()).startsWith('buttons.save'), `client <title>: ${await page.title()}`);
    assertEqual(await page.locator('h1:visible').count(), 0, 'no visible <h1>');
    assertEqual(await page.locator('h1').count(), 0, 'no <h1> at all');
    pc.expectNoErrors('TC-9.7');
  } finally {
    await pc.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------- PUI-2

const panelBase = `${env.panelUrl}/panel`;

async function panelPage(account, route, ready, { waitBoot = true } = {}) {
  const pc = await newContext(globalThis.__browser, { locale: 'en-US', cookies: account.playwrightCookies() });
  await blockDevBounce(pc);
  const page = await pc.page();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  const response = await page.goto(`${panelBase}${route}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  if (waitBoot) await hydrated(page);
  if (ready) await ready(page);
  return { pc, page, requests, status: response?.status() ?? 0 };
}

check('PUI-2.1', 'a PlayerDetailLayout page requests /api/panel/players/<name> (never undefined) and renders', async () => {
  const a = await ensureAdmin();
  const player = await newBuyer(env, a, 'pui1');
  const { pc, page, requests } = await panelPage(a, `/players/detail/${player.username}`, (p) =>
    p.locator('a', { hasText: /^Fixture$/ }).first().waitFor({ timeout: 90000 }),
  );

  try {
    // a client-side navigation: the page's load runs in the browser, so its request is visible here
    requests.length = 0;
    await page.locator('a', { hasText: /^Fixture$/ }).first().click();
    await page.locator('[data-fixture="player-tab"]').waitFor({ timeout: 60000 });
    const tab = page.locator('[data-fixture="player-tab"]');
    assertEqual(await tab.getAttribute('data-fixture-username'), player.username, 'event.params.username in the page load');
    assertEqual(await tab.getAttribute('data-fixture-url'), `/api/panel/players/${player.username}`, 'the URL the page load requested');
    assertEqual(await tab.getAttribute('data-fixture-status'), 'ok', 'the API answered ok');
    assertEqual(await tab.getAttribute('data-fixture-player-id'), String(player.userId), 'the player the API returned');
    const playerCalls = requests.filter((u) => new URL(u).pathname.endsWith(`/api/panel/players/${player.username}`));
    assert(playerCalls.length >= 1, `the player request went out: ${requests.join(', ')}`);
    const bad = requests.filter((u) => u.includes('/undefined'));
    assertEqual(bad.length, 0, `no request to .../undefined: ${bad.join(', ')}`);

    // and the same on a direct (server-rendered) load
    await page.goto(`${panelBase}/players/detail/${player.username}/fixture`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await hydrated(page);
    await page.locator('[data-fixture="player-tab"]').waitFor({ timeout: 60000 });
    assertEqual(await tab.getAttribute('data-fixture-url'), `/api/panel/players/${player.username}`, 'SSR: the URL the page load requested');
    assertEqual(await tab.getAttribute('data-fixture-player-id'), String(player.userId), 'SSR: the player the API returned');
    pc.expectNoErrors('PUI-2.1');
  } finally {
    await pc.close();
  }
});

check('PUI-2.2', 'the Fixture tab appears only with the permission', async () => {
  const a = await ensureAdmin();
  const player = await newBuyer(env, a, 'pui2');
  staff.without ??= await staffAccount('pui2n', [PANEL_ACCESS, MANAGE_PLAYERS]);
  staff.with ??= await staffAccount('pui2y', [PANEL_ACCESS, MANAGE_PLAYERS, FIXTURE_NODE]);
  const overview = (p) => p.getByText(player.username).first().waitFor({ timeout: 90000 });
  const tabLink = (page) => page.locator('a', { hasText: /^Fixture$/ });

  // a positive "the fixture plugin finished loading and its menu edit is applied" signal, then a rendered-frame wait so the menu has re-rendered from the store
  const menuEdited = async (page) => {
    await page.waitForFunction(() => document.documentElement.dataset.tc9FixtureMenuEdited === '1', null, { timeout: 120000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };

  for (const [label, account, expected] of [
    ['admin', a, 1],
    ['holder of the node', staff.with, 1],
    ['staff without the node', staff.without, 0],
  ]) {
    const { pc, page } = await panelPage(account, `/players/detail/${player.username}`, overview);

    try {
      await page.locator('a', { hasText: /^Sessions$/ }).first().waitFor({ timeout: 60000 }); // the menu is rendered
      await menuEdited(page); // the fixture's edit is in the store: 0 links now means "filtered by the permission", not "not applied yet"
      assertEqual(await tabLink(page).count(), expected, `Fixture tab links for the ${label}`);
    } finally {
      await pc.close();
    }
  }

  // a user without the node who types the URL gets the panel's not-found view, HTTP 404, no fixture content and no fixture request
  {
    const { pc, page, requests, status } = await panelPage(staff.without, `/players/detail/${player.username}/fixture`, null, { waitBoot: false });

    try {
      assertEqual(status, 404, 'a user without the node opening the tab URL directly gets HTTP 404');
      // `hydrated()` does not apply here: the panel never sets window.__PANO_APP_BOOTED__ on its error view (checked: the flag stays undefined on this 404), so the
      // positive signals are the load event and the panel's own error view (Error.svelte), awaited with the same long timeout as every other navigation
      await page.waitForLoadState('load', { timeout: 120000 });
      await page.locator('img[src$="/assets/img/404.png"]').waitFor({ timeout: 120000 });
      assertEqual(await page.locator('[data-fixture="player-tab"]').count(), 0, 'no fixture content for a user without the node');
      assertEqual(await tabLink(page).count(), 0, 'no Fixture tab link on the not-found view');
      const fixtureCalls = requests.filter((u) => new URL(u).pathname.endsWith(`/api/panel/players/${player.username}`) && new URL(u).searchParams.has('tc9fixture'));
      assertEqual(fixtureCalls.length, 0, `the fixture page load issued no request: ${fixtureCalls.join(', ')}`);
      note(`PUI-2 item 2: a user without the node opening the tab URL directly gets HTTP ${status}, the panel's not-found view and no fixture content`);
    } finally {
      await pc.close();
    }
  }

  // the positive control of the same page object: the holder of the node on the same URL gets HTTP 200 and the fixture content
  {
    const { pc, page, status } = await panelPage(staff.with, `/players/detail/${player.username}/fixture`, null);

    try {
      assertEqual(status, 200, 'the holder of the node opening the tab URL directly gets HTTP 200');
      await page.locator('[data-fixture="player-tab"]').waitFor({ timeout: 90000 });
    } finally {
      await pc.close();
    }
  }
});

check('PUI-2.3', '/players/detail/<name>/fixture renders through the catch-all, Details (overview) and Sessions still work', async () => {
  const a = await ensureAdmin();
  const player = await newBuyer(env, a, 'pui3');
  const { pc, page } = await panelPage(a, `/players/detail/${player.username}`, (p) =>
    p.locator('a', { hasText: /^Fixture$/ }).first().waitFor({ timeout: 90000 }),
  );

  try {
    const base = `/panel/players/detail/${player.username}`;
    const path = () => new URL(page.url()).pathname;

    await page.locator('a', { hasText: /^Fixture$/ }).first().click();
    await page.locator('[data-fixture="player-tab"]').waitFor({ timeout: 60000 });
    assertEqual(path(), `${base}/fixture`, 'the Fixture tab URL');
    // the layout around it is intact: the player's name, the tab menu with all three tabs
    for (const label of ['Details', 'Sessions', 'Fixture'])
      assert((await page.locator('a', { hasText: new RegExp(`^${label}$`) }).count()) >= 1, `tab ${label} is in the menu`);

    await page.locator('a', { hasText: /^Sessions$/ }).first().click();
    await page.waitForURL((u) => u.pathname === `${base}/sessions`, { timeout: 30000 });
    await page.getByText(/session/i).first().waitFor({ timeout: 30000 });
    assertEqual(await page.locator('[data-fixture="player-tab"]').count(), 0, 'the fixture content is gone on Sessions');

    await page.locator('a', { hasText: /^Details$/ }).first().click();
    await page.waitForURL((u) => u.pathname === base, { timeout: 30000 });
    await page.getByText(player.username).first().waitFor({ timeout: 30000 });
    assertEqual(await page.locator('[data-fixture="player-tab"]').count(), 0, 'the fixture content is gone on Details');

    // a direct (SSR) load of the fixture URL and a reload of Sessions also work
    await page.goto(`${panelBase}/players/detail/${player.username}/fixture`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await hydrated(page);
    await page.locator('[data-fixture="player-tab"]').waitFor({ timeout: 60000 });
    await page.goto(`${panelBase}/players/detail/${player.username}/sessions`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await hydrated(page);
    await page.getByText(/session/i).first().waitFor({ timeout: 30000 });
    pc.expectNoErrors('PUI-2.3');
  } finally {
    await pc.close();
  }
});

check('PUI-2.4', "import '@panomc/sdk/utils/auth' no longer throws in the panel", async () => {
  const a = await ensureAdmin();
  const player = await newBuyer(env, a, 'pui4');
  const { pc, page } = await panelPage(a, `/players/detail/${player.username}/fixture`, (p) =>
    p.locator('[data-fixture="player-tab"]').waitFor({ timeout: 90000 }),
  );

  try {
    assertEqual(
      await page.locator('[data-fixture="player-tab"]').getAttribute('data-fixture-auth'),
      'function',
      'typeof hasPermission imported from @panomc/sdk/utils/auth',
    );
    const loaded = await page.evaluate(async () => {
      try {
        const m = await import('@panomc/sdk/utils/auth');
        return typeof m.hasPermission;
      } catch (e) {
        return `throws: ${e?.message ?? e}`;
      }
    }).catch((e) => `evaluate failed: ${e?.message ?? e}`);
    note(`PUI-2 item 4: dynamic import of @panomc/sdk/utils/auth in the page: ${loaded}`);
    pc.expectNoErrors('PUI-2.4'); // the plugin's own probe logs a console error when the import throws or hasPermission is missing
  } finally {
    await pc.close();
  }
});

check('PUI-2.5', 'a plugin notification renders its text and details.href navigates under /panel', async () => {
  const a = await ensureAdmin();
  must(await a.post('/api/panel/tc9-fixture/notify?href=%2Ffixture%2Ftarget'), 'fixture notify');
  const { pc, page } = await panelPage(a, '/notifications', (p) =>
    p.locator('span:visible', { hasText: 'The fixture plugin says hello' }).first().waitFor({ timeout: 90000 }),
  );

  try {
    const body = await page.locator('body').innerText();
    assert(!/notifications\.FIXTURE/.test(body), 'no raw translation key');
    assert(!/Unknown notification|notifications\.UNKNOWN/i.test(body) || /fixture plugin/.test(body), 'the plugin text is shown, not the unknown fallback');
    await page.locator('span:visible', { hasText: 'The fixture plugin says hello' }).first().click();
    await page.waitForURL((u) => u.pathname === '/panel/fixture/target', { timeout: 30000 });
    await page.locator('[data-fixture="notification-target"]').waitFor({ timeout: 60000 });
    assert(page.url().startsWith(`${panelBase}/fixture/target`), `navigated under /panel on the panel origin: ${page.url()}`);
    pc.expectNoErrors('PUI-2.5');
  } finally {
    await pc.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------- run

const wanted = checks.filter(
  (c) => !filters.length || filters.some((f) => c.id.toLowerCase().includes(f.toLowerCase())),
);
const browser = await launch();
globalThis.__browser = browser;
let failed = 0;
let executed = 0;

try {
  for (const c of wanted) {
    const started = Date.now();
    executed++;

    try {
      await c.run();
      console.log(`PASS ${c.id} ${c.title} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (error) {
      failed++;
      console.log(
        `FAIL ${c.id} ${c.title} (${((Date.now() - started) / 1000).toFixed(1)}s)\n  ${String(error?.stack || error).split('\n').slice(0, 10).join('\n  ')}`,
      );
    }
  }
} finally {
  await browser.close().catch(() => {});
}

console.log(`E2E19-SUMMARY executed=${executed} failed=${failed} skipped=0`);
process.exit(failed ? 1 : 0);
