import { beforeEach, describe, expect, test } from 'bun:test';
import {
  addListener,
  addPluginListener,
  notificationTextKey,
  onNotificationClick,
  resetPluginListeners,
} from '../NotificationManager.js';

beforeEach(() => resetPluginListeners());

describe('NotificationManager (TC-6)', () => {
  test('text key with and without pluginId', () => {
    expect(notificationTextKey({ type: 'X' })).toBe('notifications.X');
    expect(notificationTextKey({ type: 'X', pluginId: 'market' })).toBe(
      'plugins.market.notifications.X',
    );
  });
  test('plugin listener called, no navigation', () => {
    const calls = [];
    const nav = [];
    addPluginListener('A', (n) => calls.push(n.type));
    onNotificationClick({ type: 'A', details: { href: '/x' } }, (p) => nav.push(p));
    expect(calls).toEqual(['A']);
    expect(nav).toEqual([]);
  });
  test('core listener runs before plugin listener', () => {
    const order = [];
    addListener('B', () => order.push('core'));
    addPluginListener('B', () => order.push('plugin'));
    onNotificationClick({ type: 'B' });
    expect(order).toEqual(['core', 'plugin']);
  });
  test('reset clears plugin listeners', () => {
    const calls = [];
    const nav = [];
    addPluginListener('C', () => calls.push(1));
    resetPluginListeners();
    onNotificationClick({ type: 'C', details: { href: '/y' } }, (p) => nav.push(p));
    expect(calls).toEqual([]);
    expect(nav).toEqual(['/y']);
  });
  test('href navigation only for safe local paths', () => {
    const nav = [];
    const go = (p) => nav.push(p);
    for (const href of ['//evil.com', '/a\\b', '/a\nb', 'https://x.com', 'x', '', undefined, 5]) {
      onNotificationClick({ type: 'D', details: { href } }, go);
    }
    onNotificationClick({ type: 'D' }, go);
    expect(nav).toEqual([]);
    onNotificationClick({ type: 'D', details: { href: '/orders/1?a=b' } }, go);
    expect(nav).toEqual(['/orders/1?a=b']);
  });
  test('no navigate callback does not throw', () => {
    expect(() => onNotificationClick({ type: 'E', details: { href: '/a' } })).not.toThrow();
  });
});
