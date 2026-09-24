import { expect, it } from 'vitest';
import { sharedPackageSmoke } from '../index';

it('smoke: package harness runs', () => {
  expect(1 + 1).toBe(2);
  expect(sharedPackageSmoke()).toBe('@catan/shared connected');
});
