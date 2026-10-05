import { describe, expect, mock, test } from 'bun:test';

mock.module('$app/paths', () => ({ base: '' }));
mock.module('../PluginManager.js', () => ({ registeredPages: {} }));

const { createFeatureSet } = await import('../PluginAPI.js');

describe('createFeatureSet (TC-7)', () => {
  test('has', () => {
    const f = createFeatureSet(['b', 'a']);
    expect(f.has('a')).toBe(true);
    expect(f.has('z')).toBe(false);
  });
  test('sorted list, deduplicated', () => {
    expect(createFeatureSet(['c', 'a', 'b', 'a']).list()).toEqual(['a', 'b', 'c']);
  });
  test('frozen', () => {
    const f = createFeatureSet(['a']);
    expect(Object.isFrozen(f)).toBe(true);
    expect(() => {
      'use strict';
      f.has = () => true;
    }).toThrow();
  });
});
