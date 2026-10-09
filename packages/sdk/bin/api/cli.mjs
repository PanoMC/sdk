// Argument handling and dispatch of the pano-api CLI.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './util.mjs';

const HELP = `pano-api - Pano API v1 tooling (migration, route extraction, path check, OpenAPI snapshots)

Usage: pano-api <command> [options] [dir]

Commands
  extract-routes [--core] [--check] [--out <file>] [--plugin-id <id>] [dir]
      Static scan of @Endpoint Kotlin classes. Prints the route list as JSON; --core writes sdk/api/routes.core.json.
      --check validates every declared path (doc 04 section 2) and, with --core / --out, that the file is current.
  migrate-v1 [--strip <segment>] [--only a,b,..] [--check] [--plugin-id <id>] [dir]
      Steps: a Kotlin paths, b Error codes, c validation imports, d api-level in build.gradle.kts,
      e client path literals, f client result reads. --check changes nothing and exits 1 when something would change
      or a leftover (/api/ literal, .result comparison, totalPage) remains.
  check-paths [--routes <routes.core.json>] [--plugin-id <id>] [dir]
      Every path passed to ApiUtil / api must be a Pano route.
  openapi-snapshot --url <pano> (--write | --check) [--core-dir <dir>] [--plugins-dir <dir>] [--repo <dir>]
                   [--plugin <id>]... [--today <date>] [--allow-breaks]
      Fetches the OpenAPI documents of a running Pano and writes / compares the committed snapshots.
  api-compat <old.json> <new.json> [--today <date>]
      Lists breaking differences between two OpenAPI documents (exit 1 when there are any).

dir defaults to the current directory. All commands are idempotent.
`;

/** @param {string[]} argv process.argv.slice(2) @returns {Promise<number>} */
export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);
    return command ? 0 : 1;
  }
  try {
    switch (command) {
      case 'extract-routes': {
        const { flags, positional } = parseArgs(rest, { bool: ['core', 'check'], value: ['out', 'plugin-id'] });
        const { runExtractRoutes } = await import('./extract-routes.mjs');
        return runExtractRoutes({ root: positional[0] || '.', core: !!flags.core, check: !!flags.check, out: flags.out, pluginId: flags['plugin-id'] });
      }
      case 'migrate-v1': {
        const { flags, positional } = parseArgs(rest, { bool: ['check'], value: ['strip', 'only', 'plugin-id'] });
        const only = flags.only ? String(flags.only).split(',').map((s) => s.trim()).filter(Boolean) : [];
        const bad = only.filter((s) => !/^[a-f]$/.test(s));
        if (bad.length) throw new Error(`--only takes letters a-f, got "${bad.join(',')}"`);
        const { runMigrateV1 } = await import('./migrate-v1.mjs');
        return runMigrateV1({ root: positional[0] || '.', check: !!flags.check, only, strip: flags.strip || null, pluginId: flags['plugin-id'] || null });
      }
      case 'check-paths': {
        const { flags, positional } = parseArgs(rest, { value: ['routes', 'plugin-id'] });
        const { runCheckPaths } = await import('./check-paths.mjs');
        return runCheckPaths({ root: positional[0] || '.', routes: flags.routes, pluginId: flags['plugin-id'] || null });
      }
      case 'openapi-snapshot': {
        const { flags } = parseArgs(rest, { bool: ['write', 'check', 'allow-breaks'], value: ['url', 'core-dir', 'plugins-dir', 'repo', 'plugin', 'today'] });
        if (!flags.url) throw new Error('--url <pano> is required');
        if (!flags.write && !flags.check) throw new Error('pass --write or --check');
        const { runOpenapiSnapshot } = await import('./openapi-snapshot.mjs');
        return await runOpenapiSnapshot({
          url: flags.url, write: !!flags.write, check: !!flags.check, allowBreaks: !!flags['allow-breaks'], today: flags.today,
          coreDir: path.resolve(flags['core-dir'] || path.join('Pano', 'api')),
          pluginsDir: flags['plugins-dir'] ? path.resolve(flags['plugins-dir']) : undefined,
          repo: flags.repo, plugins: flags.plugin ? [].concat(flags.plugin) : undefined,
        });
      }
      case 'api-compat': {
        const { flags, positional } = parseArgs(rest, { value: ['today'] });
        if (positional.length !== 2) throw new Error('api-compat takes <old.json> <new.json>');
        const { runApiCompat } = await import('./api-compat.mjs');
        return runApiCompat({ oldFile: positional[0], newFile: positional[1], today: flags.today }, (p) => JSON.parse(fs.readFileSync(p, 'utf8')));
      }
      default:
        console.error(`pano-api: unknown command "${command}"\n`);
        process.stdout.write(HELP);
        return 1;
    }
  } catch (e) {
    console.error(`pano-api ${command}: ${e.message}`);
    return 2;
  }
}
