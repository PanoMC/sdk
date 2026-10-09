import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run } from './cli.js'
import { ClientGenError } from './errors.js'
import { scaffold } from './new.js'
import { tmp } from './test-helpers.js'

const dirs = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** a tiny template with the shape of the starter: .env.example, a build script, ignored folders */
function template() {
  const t = tmp('tpl')
  dirs.push(t)
  writeFileSync(
    join(t, 'package.json'),
    JSON.stringify({ name: 'pano-starter-sveltekit', private: true, scripts: { build: "bun -e \"require('fs').writeFileSync('built.txt','ok')\"" } }, null, 2)
  )
  writeFileSync(join(t, '.env.example'), '# Where Pano answers.\nAPI_URL=http://localhost:8088/api\nPANO_FRONTEND_KEY=\n')
  mkdirSync(join(t, 'src/lib/pano'), { recursive: true })
  writeFileSync(join(t, 'src/lib/pano/index.json'), '{}')
  for (const skipped of ['node_modules', '.git', 'build', '.svelte-kit']) {
    mkdirSync(join(t, skipped), { recursive: true })
    writeFileSync(join(t, skipped, 'x'), 'x')
  }
  return t
}

describe('new', () => {
  test('--from copies the template, names the package, writes .env, runs bun install, and the tree builds', async () => {
    const t = template()
    const cwd = tmp('new')
    dirs.push(cwd)
    const outs = []
    const code = await run(['new', 'my-site', '--from', t], { cwd, stdout: (s) => outs.push(s), stderr: () => {} })
    expect(code).toBe(0)
    const site = join(cwd, 'my-site')
    expect(JSON.parse(readFileSync(join(site, 'package.json'), 'utf8')).name).toBe('my-site')
    expect(readFileSync(join(site, '.env'), 'utf8')).toBe(readFileSync(join(t, '.env.example'), 'utf8'))
    expect(existsSync(join(site, 'src/lib/pano/index.json'))).toBe(true)
    for (const skipped of ['.git', 'build', '.svelte-kit']) expect(existsSync(join(site, skipped))).toBe(false)
    expect(existsSync(join(site, 'bun.lock')) || existsSync(join(site, 'bun.lockb')) || existsSync(join(site, 'node_modules'))).toBe(true)
    expect(outs.at(-1)).toBe('\nNext: cd my-site && bun dev')

    const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: site })
    expect(build.exitCode).toBe(0)
    expect(readFileSync(join(site, 'built.txt'), 'utf8')).toBe('ok')
  })

  test('--url rewrites API_URL (the /api suffix is added once)', async () => {
    const t = template()
    const cwd = tmp('new-url')
    dirs.push(cwd)
    await scaffold({ dir: 'a', from: t, cwd, install: false, url: 'https://pano.example.com/' })
    await scaffold({ dir: 'b', from: t, cwd, install: false, url: 'http://localhost:9000/api' })
    expect(readFileSync(join(cwd, 'a/.env'), 'utf8')).toContain('API_URL=https://pano.example.com/api\n')
    expect(readFileSync(join(cwd, 'a/.env'), 'utf8')).toContain('PANO_FRONTEND_KEY=\n')
    expect(readFileSync(join(cwd, 'b/.env'), 'utf8')).toContain('API_URL=http://localhost:9000/api\n')
  })

  test('refuses a directory that is not empty, and a missing template', async () => {
    const t = template()
    const cwd = tmp('new-refuse')
    dirs.push(cwd)
    mkdirSync(join(cwd, 'taken'))
    writeFileSync(join(cwd, 'taken/file'), 'x')
    await expect(scaffold({ dir: 'taken', from: t, cwd, install: false })).rejects.toThrow(`${join(cwd, 'taken')} already exists and is not empty.`)
    await expect(scaffold({ dir: 'z', from: join(cwd, 'nope'), cwd, install: false })).rejects.toThrow('is not a directory')
    await expect(scaffold({ dir: '', from: t, cwd })).rejects.toBeInstanceOf(ClientGenError)
  })

  test('a failing install keeps the project and says what to do', async () => {
    const t = template()
    const cwd = tmp('new-install')
    dirs.push(cwd)
    await expect(scaffold({ dir: 's', from: t, cwd, installer: () => ({ ok: false, message: 'exit code 1' }) })).rejects.toThrow(
      `bun install failed in ${join(cwd, 's')} (exit code 1). The project is created; run bun install there yourself.`
    )
    expect(existsSync(join(cwd, 's/.env'))).toBe(true)
  })

  test('without --from the starter is downloaded (stubbed fetch + tarball)', async () => {
    const t = template()
    const cwd = tmp('new-dl')
    dirs.push(cwd)
    const tarDir = tmp('tar')
    dirs.push(tarDir)
    // GitHub tarballs have one top folder
    const tar = join(tarDir, 's.tar.gz')
    Bun.spawnSync(['tar', '-czf', tar, '-C', join(t, '..'), '--transform', 's,^[^/]*,pano-starter-main,', t.split('/').pop()])
    const bytes = readFileSync(tar)
    let asked = ''
    const fakeFetch = async (/** @type {string} */ url) => {
      asked = url
      return new Response(bytes)
    }
    await scaffold({ dir: 'dl', cwd, install: false, fetch: /** @type {any} */ (fakeFetch) })
    expect(asked).toContain('pano-starter-sveltekit')
    expect(JSON.parse(readFileSync(join(cwd, 'dl/package.json'), 'utf8')).name).toBe('dl')
    expect(existsSync(join(cwd, 'dl/.env'))).toBe(true)

    const failing = async () => new Response('no', { status: 404 })
    await expect(scaffold({ dir: 'dl2', cwd, install: false, fetch: /** @type {any} */ (failing) })).rejects.toThrow('Pass --from <dir> instead.')
  })
})
