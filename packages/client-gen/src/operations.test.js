import { describe, expect, test } from 'bun:test'
import { collectOperations, serverPrefix } from './operations.js'

const get = { operationId: 'Thing', responses: { 200: { description: 'ok' } } }

describe('server prefix of an operation path', () => {
  test('serverPrefix reads the path of a relative or absolute server url', () => {
    expect(serverPrefix([{ url: '/api/plugins/pano-plugin-market/' }])).toBe('/api/plugins/pano-plugin-market')
    expect(serverPrefix([{ url: 'https://pano.test/api/v1' }])).toBe('/api/v1')
    expect(serverPrefix([{ url: '/' }])).toBe('')
    expect(serverPrefix(undefined)).toBe('')
  })

  test('the document server prefixes every path', () => {
    const [op] = collectOperations({ servers: [{ url: '/api/plugins/pano-plugin-market' }], paths: { '/store/products': { get } } })
    expect(op.path).toBe('/api/plugins/pano-plugin-market/store/products')
    expect(op.docPath).toBe('/store/products')
  })

  test('an operation-level servers entry overrides the document server (internal document panel routes)', () => {
    const doc = {
      servers: [{ url: '/api/v1' }],
      paths: {
        '/posts': { get },
        '/plugins/pano-plugin-market/panel/products': { get: { ...get, operationId: 'Panel', servers: [{ url: '/api' }] } }
      }
    }
    const byId = Object.fromEntries(collectOperations(doc).map((o) => [o.id, o.path]))
    expect(byId.Thing).toBe('/api/v1/posts')
    expect(byId.Panel).toBe('/api/plugins/pano-plugin-market/panel/products')
  })

  test('a path that already carries the prefix is not doubled', () => {
    const [op] = collectOperations({ servers: [{ url: '/api/v1' }], paths: { '/api/v1/posts': { get } } })
    expect(op.path).toBe('/api/v1/posts')
  })
})
