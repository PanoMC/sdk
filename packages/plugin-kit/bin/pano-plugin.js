#!/usr/bin/env node
// pano-plugin: the command line of @panomc/plugin-kit (doc 02 section 8).
// Every command is imported on demand, so `pano-plugin --help` loads neither rollup nor svelte.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HELP = `pano-plugin - build and check a Pano plugin

Usage: pano-plugin <command> [options]

Commands
  dev [--pano <url>]              Build the jar once when none exists, then rollup watch.
  build                           Build the plugin UI package (src/main/resources/plugin-ui).
  check [--strict] [--styles badge]
                                  Build rules, lock, style lint, Svelte pin and API paths.
                                  --strict fails on warnings too and needs a samples file with 'filled' (and
                                  every standard state not in notApplicable) for every view;
                                  --styles badge runs the badge lint.
  classes [--fix]                 List the semantic classes the sources lack; --fix writes them.
  new [<id>] [--package x.y] [--local <dir>]
                                  Scaffold a plugin in ./<id> (run it in Pano's plugins folder).
  samples [<View>]                Write <View>.samples.js next to the view (the four standard states, one line
                                  per required prop); without a name list the views and their samples.
  publish-controllers             Not available yet.

Run it in the plugin folder (the one with gradle.properties and rollup.config.js).
`;

const NOT_YET = new Set(['publish-controllers']);
const FLAGS = {
  dev: { value: ['pano'], bool: [] },
  build: { value: ['config'], bool: [] },
  check: { value: ['styles'], bool: ['strict'] },
  classes: { value: [], bool: ['fix'] },
  samples: { value: [], bool: [] },
};

/**
 * @param {string[]} args
 * @param {{ value: string[], bool: string[] }} spec
 * @returns {{ flags: Record<string, string | boolean>, rest: string[] }}
 */
function parse(args, spec) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const rest = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }

    const [name, inline] = arg.slice(2).split(/=(.*)/s);

    if (spec.bool.includes(name)) flags[name] = true;
    else if (spec.value.includes(name)) {
      const value = inline ?? args[++i];

      if (value === undefined) throw new Error(`--${name} needs a value`);

      flags[name] = value;
    } else throw new Error(`unknown option ${arg} (see pano-plugin --help)`);
  }

  return { flags, rest };
}

/** @param {string[]} argv @returns {Promise<number>} */
export async function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(HELP);

    return command ? 0 : 1;
  }

  if (NOT_YET.has(command)) {
    process.stderr.write(`pano-plugin ${command}: not available yet\n`);

    return 1;
  }

  if (command === 'new') {
    // own argument parser: the id comes first and --local takes an optional folder
    const { runNew } = await import('./new.js');

    return await runNew(args);
  }

  if (!(command in FLAGS)) {
    process.stderr.write(`pano-plugin: unknown command "${command}"\n\n${HELP}`);

    return 1;
  }

  try {
    const { flags, rest } = parse(args, FLAGS[/** @type {keyof typeof FLAGS} */ (command)]);

    switch (command) {
      case 'dev': {
        const { runDev } = await import('../src/dev.js');

        return await runDev({ pano: /** @type {string | undefined} */ (flags.pano) });
      }
      case 'build': {
        const { runBuild } = await import('../src/rollup/cli-build.js');

        return await runBuild({ config: /** @type {string | undefined} */ (flags.config) });
      }
      case 'check': {
        if (flags.styles !== undefined && flags.styles !== 'badge' && flags.styles !== 'core') {
          throw new Error('--styles takes "badge" (or "core")');
        }

        const { runCheckWithSamples } = await import('../src/rollup/samples.js');

        return await runCheckWithSamples({
          strict: flags.strict === true,
          styles: flags.styles === 'badge' ? 'badge' : 'core',
        });
      }
      case 'classes': {
        const { runClasses } = await import('../src/rollup/cli-classes.js');

        return await runClasses({ fix: flags.fix === true });
      }
      case 'samples': {
        if (rest.length > 1) throw new Error('samples takes one view name');

        const { runSamples } = await import('../src/rollup/samples.js');

        return await runSamples({ view: rest[0] });
      }
    }
  } catch (error) {
    process.stderr.write(`pano-plugin ${command}: ${/** @type {Error} */ (error).message}\n`);

    return 1;
  }

  return 1;
}

/** True when this file is the program being run (also through a `node_modules/.bin` link). */
function isMain() {
  if (typeof import.meta.main === 'boolean') return import.meta.main;

  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exitCode = await main(process.argv.slice(2));
}
