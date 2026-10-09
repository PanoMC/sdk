// Shared helpers of the CLI tests: temp themes, synthetic plugin packages, the CLI runner.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll } from "bun:test";

export const binDir = resolve(import.meta.dir, "..", "..");
export const cliPath = join(binDir, "theme-core.js");
export const repoRoot = resolve(binDir, "..", "..", "..");

/** The built fixture plugin (gitignored build output); null when it was not built on this machine. */
export const pluginMinDir = (() => {
  const dir = join(repoRoot, "test-fixtures", "plugin-min", "src", "main", "resources", "plugin-ui");
  return existsSync(join(dir, "contract", "views.json")) ? dir : null;
})();

const roots = [];

/** Removes every temp folder when the test file ends. Call once per file. */
export function cleanupAfterAll() {
  afterAll(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
}

export function tempDir(prefix = "tc40-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

export function write(root, rel, content) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

export const read = (root, rel) => readFileSync(join(root, rel), "utf8");
export const readJson = (root, rel) => JSON.parse(read(root, rel));
export const exists = (root, rel) => existsSync(join(root, rel));

export const DEFAULT_CONFIG = `export default {
  views: {},
};
`;

/** A theme folder: theme.config.js (unless null) and whatever else is passed. */
export function makeTheme({ config = DEFAULT_CONFIG, files = {} } = {}) {
  const dir = tempDir("tc40-theme-");
  if (config !== null) write(dir, "theme.config.js", config);
  write(dir, "package.json", JSON.stringify({ name: "test-theme", type: "module" }));
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  return dir;
}

/** Runs `bun bin/theme-core.js <args>` inside a theme. */
export function cli(themeDir, args, { env = {} } = {}) {
  const result = spawnSync("bun", [cliPath, ...args], {
    cwd: themeDir,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: "1", ...env },
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", out: (result.stdout ?? "") + (result.stderr ?? "") };
}

/** Imports the theme's config as the build would. */
export async function importConfig(themeDir) {
  return (await import(`${join(themeDir, "theme.config.js")}?t=${Date.now()}${Math.random()}`)).default;
}

/** Copies a package folder to plugins/<pluginId>/ of the theme. */
export function installPackage(themeDir, packageDir, pluginId) {
  cpSync(packageDir, join(themeDir, "plugins", pluginId), { recursive: true });
  return join(themeDir, "plugins", pluginId);
}

// ---------------------------------------------------------------------------
// A synthetic package shaped like the output of the plugin kit
// ---------------------------------------------------------------------------

export const PRODUCT_CARD = `<script module>
  /** Where the view mounts. */
  export const view = {
    block: true,
    controller: 'market/cart',
  };

  /** Data of the view. */
  export async function load(event, props) {
    const response = await event.fetch('/api/plugins/pano-plugin-market/store/products');
    return { products: await response.json() };
  }

  export const prerender = false;
</script>

<script>
  import PriceTag from './PriceTag.svelte';
  import { onSale } from '../_lib/lib/sale.js';
  import { plugin } from '@panomc/sdk/controllers';

  let { product, settings = null } = $props();
  const cart = plugin('market').require('cart');
  const money = plugin('market').require('format');
</script>

<div class="market-product-card">
  <h3>{product.name}</h3>
  <PriceTag price={product.price} sale={onSale(product)} />
  <button onclick={() => cart.actions.add(product)}>{money.state.symbol}</button>
</div>
`;

export const PRICE_TAG = `<script>
  let { price, sale = false } = $props();
</script>

<span class="market-price-tag" class:sale>{price}</span>
`;

export const STORE_PAGE = `<script module>
  export const view = { path: '/store' };
</script>

<script>
  import ProductCard from '../components/ProductCard.svelte';
  import { onSale } from '../_lib/lib/sale.js';

  let { products = [] } = $props();
</script>

<section class="market-store-page">
  {#each products as product}
    <ProductCard {product} />
  {/each}
</section>
`;

export const SALE_JS = `import { percent } from './fmt.js';

export function onSale(product) {
  return percent(product) > 0;
}
`;

export const FMT_JS = `export function percent(product) {
  return product.sale ? 10 : 0;
}
`;

/**
 * Writes a plugin package. `overrides` can replace parts of the default market-like content.
 * @param {string} dir
 * @param {{ ns?: string, pluginId?: string, productCardContract?: number, cartVersion?: number, viewImports?: 'warn', version?: string }} [options]
 */
export function writeMarketPackage(
  dir,
  { ns = "market", pluginId = "pano-plugin-market", productCardContract = 1, cartVersion = 1, viewImports, version = "1.0.0" } = {},
) {
  const views = {
    [`${ns}:ProductCard`]: {
      kind: "component",
      contract: productCardContract,
      source: "src/components/ProductCard.svelte",
      props: { product: { type: "any", required: true }, settings: { type: "any", required: false } },
      uses: [`${ns}:PriceTag`],
      slots: [],
      hooks: [],
      block: true,
      inject: null,
      page: null,
      home: null,
      widget: null,
    },
    [`${ns}:PriceTag`]: {
      kind: "component",
      contract: 1,
      source: "src/components/PriceTag.svelte",
      props: { price: { type: "any", required: true }, sale: { type: "any", required: false } },
      uses: [],
      slots: [],
      hooks: [],
      block: false,
      inject: null,
      page: null,
      home: null,
      widget: null,
    },
    [`${ns}:StorePage`]: {
      kind: "page",
      contract: 1,
      source: "src/pages/StorePage.svelte",
      props: { products: { type: "any", required: false } },
      uses: [`${ns}:ProductCard`],
      slots: [],
      hooks: [],
      block: false,
      inject: null,
      page: { path: "/store" },
      home: null,
      widget: null,
    },
  };

  write(dir, "contract/views.json", JSON.stringify({ namespace: ns, pluginId, version, sdk: 2, views }, null, 2));
  write(
    dir,
    "contract/controllers.json",
    JSON.stringify({
      [`${ns}/cart`]: { version: cartVersion, scope: "app", state: ["count"], actions: ["add"], types: { state: "CartState", actions: "CartActions" } },
      [`${ns}/format`]: { version: 1, scope: "app", state: ["symbol"], actions: [], types: { state: "FormatState", actions: "FormatActions" } },
    }),
  );
  write(dir, "contract/controllers.types.js", "/** @typedef {{ count: number }} CartState */\nexport {};\n");
  write(dir, "contract/src/components/ProductCard.svelte", PRODUCT_CARD);
  write(dir, "contract/src/components/PriceTag.svelte", PRICE_TAG);
  write(dir, "contract/src/pages/StorePage.svelte", STORE_PAGE);
  write(dir, "contract/src/_lib/lib/sale.js", SALE_JS);
  write(dir, "contract/src/_lib/lib/fmt.js", FMT_JS);
  write(
    dir,
    "pano-plugin.json",
    JSON.stringify(
      {
        format: 1,
        pluginId,
        namespace: ns,
        version,
        sdk: 2,
        contract: "contract/views.json",
        controllers: "contract/controllers.json",
        ...(viewImports ? { viewImports } : {}),
        views: {
          ProductCard: { samples: [], controllers: { [`${ns}/cart`]: cartVersion, [`${ns}/format`]: 1 }, helpers: ["lib/sale.js"], roots: ["div"], classes: [] },
          PriceTag: { samples: [], controllers: {}, helpers: [], roots: ["span"], classes: [] },
          StorePage: { samples: [], controllers: {}, helpers: ["lib/sale.js"], roots: ["section"], classes: [] },
        },
        badges: {},
      },
      null,
      2,
    ),
  );
  // the client/server halves exist in a real package; the CLI must never need them
  write(dir, "client/client.mjs", "export {};\n");
  return dir;
}

/** A theme with the market package installed under plugins/. */
export function themeWithMarket({ config, packageOptions } = {}) {
  const pkg = tempDir("tc40-pkg-");
  writeMarketPackage(pkg, packageOptions);
  const theme = makeTheme({ config });
  installPackage(theme, pkg, packageOptions?.pluginId ?? "pano-plugin-market");
  return { theme, pkg };
}
