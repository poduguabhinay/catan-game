export * from './constants';
export * from './rng';
export * from './topology';
export * from './board';
export * from './longestRoad';
export * from './protocol';
export * from './rules/index';
export function sharedPackageSmoke(): string {
  return '@catan/shared connected';
}
