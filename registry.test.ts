import { describe, it, expect } from 'vitest';
import { registry } from './registry';

describe('Registry', () => {
  it('should have basic site configuration', () => {
    expect(registry.sites.length).toBeGreaterThan(0);
    expect(registry.sites[0].domain).toBeDefined();
  });
});
