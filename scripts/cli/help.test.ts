import { describe, expect, it } from 'vitest';
import { formatCliHelp } from './help';

describe('CLI help', () => {
  it('distinguishes native sync from site-wide and targeted adapter publication', () => {
    expect(formatCliHelp({ topic: 'sync' })).toContain('Configured publishing adapters are not applied');
    expect(formatCliHelp({ topic: 'publish' })).toContain('site-wide push of changed documents');
    expect(formatCliHelp({ topic: 'publish' })).toContain('Slugs restrict adapter posts only');
    expect(formatCliHelp({ topic: 'publish' })).toContain('S3/R2 backup/sync covers the full eligible vault');
  });

  it('documents action-oriented commands and their operands', () => {
    expect(formatCliHelp({})).toContain('publish <publisher> [slug...]');
    expect(formatCliHelp({ topic: 'publish' })).toContain('Usage: notopress publish <publisher> [slug...]');
    expect(formatCliHelp({ topic: 'publisher' })).toContain('publisher init <publisher>');
    expect(formatCliHelp({ topic: 'storage' })).toContain('Writes only the manifest');
    expect(formatCliHelp({ topic: 'storage' })).toContain('--pending <file>');
    expect(formatCliHelp({ topic: 'storage' })).toContain('required live');
  });
});
