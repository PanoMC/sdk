import { describe, expect, test } from 'bun:test';
import { breaks } from '../api-compat.mjs';

const op = (extra = {}) => ({
  operationId: 'GetPosts',
  responses: {
    200: {
      description: 'ok',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Post' } }, total: { type: 'integer' } },
          },
        },
      },
    },
  },
  ...extra,
});
const spec = (paths, schemas = {}) => ({
  openapi: '3.1.0',
  paths,
  components: { schemas: { Post: { type: 'object', properties: { id: { type: 'integer' }, title: { type: 'string' } } }, ...schemas } },
});
const TODAY = '2026-10-08';

describe('api-compat', () => {
  test('identical and additive changes pass', () => {
    const a = spec({ '/posts': { get: op() } });
    const b = spec(
      { '/posts': { get: op() }, '/tags': { get: op() } },
      { Post: { type: 'object', properties: { id: { type: 'integer' }, title: { type: 'string' }, slug: { type: 'string' } } } },
    );
    expect(breaks(a, a, TODAY)).toEqual([]);
    expect(breaks(a, b, TODAY)).toEqual([]);
  });

  test('a removed operation fails', () => {
    const a = spec({ '/posts': { get: op() }, '/tags': { get: op() } });
    const b = spec({ '/posts': { get: op() } });
    expect(breaks(a, b, TODAY)).toEqual(['GET /tags: operation was removed without being deprecated']);
  });

  test('deprecated and expired passes, deprecated but not yet expired fails', () => {
    const dep = (removal) => op({ deprecated: true, 'x-pano-removal': removal, 'x-pano-deprecated-on': '2025-01-01' });
    const gone = spec({ '/posts': { get: op() } });
    expect(breaks(spec({ '/posts': { get: op() }, '/old': { get: dep('2026-06-01') } }), gone, TODAY)).toEqual([]);
    expect(breaks(spec({ '/posts': { get: op() }, '/old': { get: dep('2027-06-01') } }), gone, TODAY)).toEqual([
      'GET /old: removed before its removal date 2027-06-01',
    ]);
    expect(breaks(spec({ '/old': { get: op({ deprecated: true }) } }), spec({}), TODAY)[0]).toContain('deprecated without x-pano-removal');
  });

  test('a removed response property (also through $ref) or a changed type fails', () => {
    const a = spec({ '/posts': { get: op() } });
    const noTitle = spec({ '/posts': { get: op() } }, { Post: { type: 'object', properties: { id: { type: 'integer' } } } });
    expect(breaks(a, noTitle, TODAY)).toEqual(['GET /posts 200.items[].title: response property was removed']);
    const retyped = spec({ '/posts': { get: op() } }, { Post: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } } });
    expect(breaks(a, retyped, TODAY)).toEqual(['GET /posts 200.items[].id: type changed from integer to string']);
    const total = JSON.parse(JSON.stringify(a));
    delete total.paths['/posts'].get.responses[200].content['application/json'].schema.properties.total;
    expect(breaks(a, total, TODAY)).toEqual(['GET /posts 200.total: response property was removed']);
  });

  test('a removed response status fails', () => {
    const a = spec({ '/posts': { get: op() } });
    const b = spec({ '/posts': { get: { ...op(), responses: { 201: op().responses[200] } } } });
    expect(breaks(a, b, TODAY)).toEqual(['GET /posts: response 200 was removed']);
  });

  test('a new required request property or parameter fails, an optional one passes', () => {
    const body = (schema) => ({ required: true, content: { 'application/json': { schema } } });
    const a = spec({ '/posts': { post: op({ requestBody: body({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }) }) } });
    const bad = spec({ '/posts': { post: op({ requestBody: body({ type: 'object', properties: { title: { type: 'string' }, slug: { type: 'string' } }, required: ['title', 'slug'] }) }) } });
    const ok = spec({ '/posts': { post: op({ requestBody: body({ type: 'object', properties: { title: { type: 'string' }, slug: { type: 'string' } }, required: ['title'] }) }) } });
    expect(breaks(a, bad, TODAY)).toEqual(['POST /posts request.slug: request property became required']);
    expect(breaks(a, ok, TODAY)).toEqual([]);
    const param = (required) => spec({ '/posts': { get: op({ parameters: [{ name: 'page', in: 'query', required, schema: { type: 'integer' } }] }) } });
    expect(breaks(spec({ '/posts': { get: op() } }), param(true), TODAY)).toEqual(['GET /posts: new required query parameter "page"']);
    expect(breaks(spec({ '/posts': { get: op() } }), param(false), TODAY)).toEqual([]);
    expect(breaks(param(false), param(true), TODAY)).toEqual(['GET /posts: query parameter "page" became required']);
  });

  test('internal operations carry no promise', () => {
    const a = spec({ '/panel/x': { get: op({ 'x-pano-stability': 'internal' }) } });
    expect(breaks(a, spec({}), TODAY)).toEqual([]);
  });

  test('the deprecation floor: removal at least 6 months after x-pano-deprecated-on', () => {
    const dep = (removal) => spec({ '/old': { get: op({ deprecated: true, 'x-pano-removal': removal, 'x-pano-deprecated-on': '2026-10-01' }) } });
    expect(breaks(dep('2027-04-01'), dep('2027-04-01'), TODAY)).toEqual([]);
    expect(breaks(dep('2027-03-01'), dep('2027-03-01'), TODAY)).toEqual([
      'GET /old: x-pano-removal 2027-03-01 is less than 6 months after x-pano-deprecated-on 2026-10-01',
    ]);
  });
});
