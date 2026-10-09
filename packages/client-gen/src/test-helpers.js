import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const FIXTURE = new URL('../../../test-fixtures/openapi-mini.json', import.meta.url).pathname
export const CLIENT_PKG = new URL('../../client', import.meta.url).pathname
export const TSC = new URL('../../../node_modules/typescript/bin/tsc', import.meta.url).pathname

/** @param {string} prefix */
export const tmp = (prefix) => mkdtempSync(join(tmpdir(), `pano-cg-${prefix}-`))
