import { describe, expect, it } from 'vitest';
import { formatCliHelp } from './help';

describe('CLI help', () => {
  it('distinguishes native sync from site-wide and targeted adapter publication', () => {
    expect(formatCliHelp({ topic: 'sync' })).toContain('Configured publishing adapters are not applied');
    expect(formatCliHelp({ topic: 'publish' })).toContain('site-wide push of changed documents');
    expect(formatCliHelp({ topic: 'publish' })).toContain('WordPress sends HTML through its API');
    expect(formatCliHelp({ topic: 'publish' })).toContain('Use sync explicitly for full native distribution');
    expect(formatCliHelp({ topic: 'sources' })).toContain('No commits or pushes');
  });

  it('documents action-oriented commands and their operands', () => {
    expect(formatCliHelp({})).toContain('publish <publisher> [slug...]');
    expect(formatCliHelp({ topic: 'publish' })).toContain('Usage: notopress publish <publisher> [slug...]');
    expect(formatCliHelp({ topic: 'publisher' })).toContain('publisher init <publisher>');
  });
});
