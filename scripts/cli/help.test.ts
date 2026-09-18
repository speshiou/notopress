import { describe, expect, it } from 'vitest';
import { formatCliHelp } from './help';

describe('CLI help', () => {
  it('documents action-oriented commands and their operands', () => {
    expect(formatCliHelp({})).toContain('publish <publisher> [slug...]');
    expect(formatCliHelp({ topic: 'publish' })).toContain('Usage: notopress publish <publisher> [slug...]');
    expect(formatCliHelp({ topic: 'publisher' })).toContain('publisher init <publisher>');
  });
});
