import { describe, expect, test } from 'bun:test';
import { escapeHtml, escapeValues } from '../html.util.js';

describe('html.util (TC-5)', () => {
  test('escapes all five characters', () => {
    expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });
  test('escapeValues escapes strings only, copy', () => {
    const src = { a: '<b>', n: 5, z: null, t: true };
    const out = escapeValues(src);
    expect(out).toEqual({ a: '&lt;b&gt;', n: 5, z: null, t: true });
    expect(src.a).toBe('<b>');
    expect(out).not.toBe(src);
  });
  test('non-object gives {}', () => {
    for (const v of [null, undefined, 'x', 3, [1]]) expect(escapeValues(v)).toEqual({});
  });
});
