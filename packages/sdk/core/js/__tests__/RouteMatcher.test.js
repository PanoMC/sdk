import { describe, expect, test } from 'bun:test';
import { RouteMatcher, findMatch } from '../RouteMatcher.js';

describe('RouteMatcher decoding (TC-4)', () => {
  test('decodes a [slug] param', () => {
    expect(RouteMatcher.match('/p/[slug]', '/p/caf%C3%A9')).toEqual({ slug: 'café' });
  });
  test('decodes a :param', () => {
    expect(RouteMatcher.match('/p/:slug', '/p/caf%C3%A9')).toEqual({ slug: 'café' });
  });
  test('malformed escape kept raw', () => {
    expect(RouteMatcher.match('/p/[slug]', '/p/%E0%A4%A')).toEqual({ slug: '%E0%A4%A' });
  });
  test('%2F stays inside one segment', () => {
    expect(RouteMatcher.match('/p/[slug]', '/p/a%2Fb')).toEqual({ slug: 'a/b' });
  });
  test('catch-all decodes each segment', () => {
    expect(RouteMatcher.match('/f/[...rest]', '/f/a%20b/caf%C3%A9')).toEqual({ rest: 'a b/café' });
  });
  test('literal segments are not decoded', () => {
    expect(RouteMatcher.match('/caf%C3%A9/[id]', '/café/1')).toBeNull();
    expect(RouteMatcher.match('/caf%C3%A9/[id]', '/caf%C3%A9/1')).toEqual({ id: '1' });
  });
  test('re: groups are not decoded', () => {
    expect(RouteMatcher.match('re:/p/(?<x>.+)', '/p/a%20b')).toEqual({ x: 'a%20b' });
  });
  test('literal route wins over a dynamic one registered first', () => {
    const pages = { '/p/[slug]': { id: 'dyn' }, '/p/new': { id: 'lit' } };
    expect(findMatch(pages, '/p/new').id).toBe('lit');
    expect(findMatch(pages, '/p/new/').id).toBe('lit');
    expect(findMatch(pages, '/p/other')).toEqual({ id: 'dyn', params: { slug: 'other' } });
  });
});
