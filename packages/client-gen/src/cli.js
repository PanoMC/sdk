import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { check } from './check.js'
import { ClientGenError } from './errors.js'
import { generateClient } from './generate.js'
import { scaffold } from './new.js'
import { pull, writeFiles } from './pull.js'

export const USAGE = `pano-client - typed client generator for Pano

  pano-client generate --input <openapi.json> --out <dir>
  pano-client pull --url <pano> [--out src/lib/pano] [--plugin <pluginId>]...
  pano-client check --url <pano> [--dir src/lib/pano]
  pano-client new <dir> [--url <pano>] [--from <dir>] [--no-install]
`

/**
 * @param {string[]} argv   arguments after the program name
 * @param {{ cwd?: string, stdout?: (s: string) => void, stderr?: (s: string) => void, fetch?: typeof fetch }} [io]
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s + '\n'))
  const err = io.stderr ?? ((s) => process.stderr.write(s + '\n'))
  const cwd = io.cwd ?? process.cwd()
  const [command, ...rest] = argv

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    out(USAGE)
    return command ? 0 : 1
  }

  try {
    switch (command) {
      case 'generate': {
        const { values } = parseArgs({ args: rest, options: { input: { type: 'string' }, out: { type: 'string' } } })
        if (!values.input || !values.out) throw new ClientGenError('generate needs --input <openapi.json> and --out <dir>')
        let text
        try {
          text = readFileSync(resolve(cwd, values.input), 'utf8')
        } catch {
          throw new ClientGenError(`Cannot read ${resolve(cwd, values.input)}`)
        }
        const gen = generateClient(text)
        gen.warnings.forEach((w) => err(`warning: ${w}`))
        const dir = resolve(cwd, values.out)
        mkdirSync(dir, { recursive: true })
        writeFiles(dir, gen.files)
        out(`generated ${gen.operations.length} operations in ${dir}`)
        return 0
      }
      case 'pull': {
        const { values } = parseArgs({
          args: rest,
          options: { url: { type: 'string' }, out: { type: 'string' }, plugin: { type: 'string', multiple: true } }
        })
        await pull({ url: values.url ?? '', out: values.out, plugins: values.plugin, cwd, fetch: io.fetch, log: out })
        return 0
      }
      case 'check': {
        const { values } = parseArgs({ args: rest, options: { url: { type: 'string' }, dir: { type: 'string' } } })
        const report = await check({ url: values.url ?? '', dir: values.dir, cwd, fetch: io.fetch })
        report.notes.forEach((n) => out(n))
        if (report.ok) {
          out('ok: the generated client matches this Pano')
          return 0
        }
        report.problems.forEach((p) => err(p))
        err('The generated client is out of date. Run pano-client pull.')
        return 1
      }
      case 'new': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: { url: { type: 'string' }, from: { type: 'string' }, 'no-install': { type: 'boolean' } }
        })
        const r = await scaffold({
          dir: positionals[0] ?? '',
          url: values.url,
          from: values.from,
          install: !values['no-install'],
          cwd,
          fetch: io.fetch,
          log: out
        })
        out(`\nNext: cd ${positionals[0]} && bun dev`)
        return r.dir ? 0 : 1
      }
      default:
        err(`Unknown command "${command}".\n\n${USAGE}`)
        return 1
    }
  } catch (e) {
    if (e instanceof ClientGenError) {
      err(e.message)
      return 1
    }
    if (e && typeof e === 'object' && /** @type {any} */ (e).code?.startsWith?.('ERR_PARSE_ARGS')) {
      err(`${/** @type {Error} */ (e).message}\n\n${USAGE}`)
      return 1
    }
    throw e
  }
}
