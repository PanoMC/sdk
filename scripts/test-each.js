#!/usr/bin/env bun
// Runs every *.test.js in its own `bun test` process (mock.module leaks between files when
// they share a process). Usage: bun scripts/test-each.js [path filter ...]
import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', 'test-fixtures', '__fixtures__', '.git'])
const PARALLEL = 4

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (name.endsWith('.test.js')) out.push(relative(root, full))
  }
}

const files = []
for (const top of ['packages', 'scripts']) walk(join(root, top), files)
files.sort()

const filters = process.argv.slice(2)
const selected = filters.length ? files.filter((f) => filters.some((p) => f.includes(p))) : files

if (!selected.length) {
  console.error('no test files match')
  process.exit(1)
}

function count(text, word) {
  const m = text.match(new RegExp(`^\\s*(\\d+) ${word}\\b`, 'm'))
  return m ? Number(m[1]) : 0
}

async function runOne(file) {
  const started = Date.now()
  const proc = Bun.spawn(['bun', 'test', '--timeout', '30000', file], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  const text = out + err
  return {
    file,
    ok: code === 0,
    code,
    pass: count(text, 'pass'),
    fail: count(text, 'fail'),
    ms: Date.now() - started,
    text,
  }
}

const results = []
let next = 0
async function worker() {
  while (next < selected.length) {
    const file = selected[next++]
    const r = await runOne(file)
    results.push(r)
    const tag = r.ok ? 'pass' : 'FAIL'
    console.log(`${tag}  ${r.file}  (pass ${r.pass}, fail ${r.fail}, ${(r.ms / 1000).toFixed(1)}s)`)
  }
}
await Promise.all(Array.from({ length: Math.min(PARALLEL, selected.length) }, worker))

const failed = results.filter((r) => !r.ok).sort((a, b) => a.file.localeCompare(b.file))
for (const r of failed) {
  console.log(`\n--- ${r.file} (exit ${r.code}) ---`)
  console.log(r.text.split('\n').slice(-60).join('\n'))
}
const passN = results.reduce((n, r) => n + r.pass, 0)
const failN = results.reduce((n, r) => n + r.fail, 0)
console.log(`\n${results.length - failed.length}/${results.length} files passed, ${passN} tests passed, ${failN} failed`)
if (failed.length) {
  console.log('failed files:\n  ' + failed.map((r) => r.file).join('\n  '))
  process.exit(1)
}
