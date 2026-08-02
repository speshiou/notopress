import { describe, expect, it } from 'vitest';
import { formatWordPressSyncSummary } from './wordpress-sync-log';

describe('formatWordPressSyncSummary', () => {
  it('formats summary when all posts are up to date', () => {
    const output = formatWordPressSyncSummary({
      updated: [],
      created: [],
      failed: [],
      skippedCount: 15,
      totalProcessed: 15,
    });

    expect(output).toContain('📊 WordPress Sync Summary');
    expect(output).toContain('✨ All 15 post(s) are up to date! (0 modified)');
    expect(output).not.toContain('Updated Posts');
    expect(output).not.toContain('Created Posts');
  });

  it('formats summary for updated and created posts in live sync mode', () => {
    const output = formatWordPressSyncSummary({
      updated: [
        {
          title: 'Existing Post',
          slug: 'existing-post',
          action: 'updated',
          id: 101,
          contentType: 'post',
        },
      ],
      created: [
        {
          title: 'Brand New Post',
          slug: 'brand-new-post',
          action: 'created',
          id: 202,
          contentType: 'post',
        },
      ],
      failed: [],
      skippedCount: 10,
      totalProcessed: 12,
    });

    expect(output).toContain('✨ Processed 2 post(s) (1 updated, 1 created), 10 post(s) skipped (unchanged).');
    expect(output).toContain('📝 Updated Posts (1):');
    expect(output).toContain('• 🔄 [UPDATED] "Existing Post" (slug: existing-post, ID: 101)');
    expect(output).toContain('🆕 Created Posts (1):');
    expect(output).toContain('• 🆕 [CREATED] "Brand New Post" (slug: brand-new-post, ID: 202)');
  });

  it('formats summary for dry run mode', () => {
    const output = formatWordPressSyncSummary({
      updated: [
        {
          title: 'Updated Post',
          slug: 'updated-post',
          action: 'updated',
          id: 50,
          isDryRun: true,
        },
      ],
      created: [
        {
          title: 'Created Post',
          slug: 'created-post',
          action: 'created',
          isDryRun: true,
        },
      ],
      failed: [],
      skippedCount: 5,
      totalProcessed: 7,
      isDryRun: true,
    });

    expect(output).toContain('📊 WordPress Sync Summary (DRY RUN)');
    expect(output).toContain('✨ Would process 2 post(s) (1 updated, 1 created), 5 post(s) skipped (unchanged).');
    expect(output).toContain('• 🔄 [DRY RUN UPDATE] "Updated Post" (slug: updated-post, ID: 50)');
    expect(output).toContain('• 🆕 [DRY RUN CREATE] "Created Post" (slug: created-post)');
  });

  it('formats summary with failed items', () => {
    const output = formatWordPressSyncSummary({
      updated: [],
      created: [],
      failed: [
        {
          title: 'Bad Post',
          slug: 'bad-post',
          error: 'Connection timeout',
        },
      ],
      skippedCount: 3,
      totalProcessed: 4,
    });

    expect(output).toContain('1 failed');
    expect(output).toContain('❌ Failed Posts (1):');
    expect(output).toContain('• ❌ "Bad Post" (slug: bad-post): Connection timeout');
  });
});
