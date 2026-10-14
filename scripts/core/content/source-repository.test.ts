import { describe, expect, it } from 'vitest';
import { prepareSourceRepositoryPlan } from './source-repository';

describe('Git source repository plan', () => {
  it('preserves existing rules, ignores generated distribution and secrets, and is idempotent', () => {
    const first = prepareSourceRepositoryPlan({ gitExists: false, ignoreContent: '# User rules\n*.tmp\n' });
    expect(first.content).toContain('# User rules\n*.tmp\n');
    for (const line of ['_rendered/', '**/_thumbnails/', '/root.json', '/content/**/index.json', '.notopress/', '.env.*']) expect(first.content).toContain(line);
    expect(first.content).not.toContain('*.md');
    expect(first.content).not.toContain('*.png');
    expect(prepareSourceRepositoryPlan({ gitExists: true, ignoreContent: first.content }).content).toBe(first.content);
    expect(prepareSourceRepositoryPlan({ gitExists: false, ignoreContent: '# Changed\n' }).plan.fingerprint).not.toBe(first.plan.fingerprint);
  });
});
