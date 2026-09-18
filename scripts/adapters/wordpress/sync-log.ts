export interface WordPressSyncItemResult {
  title: string;
  slug: string;
  action: 'updated' | 'created';
  contentType?: string;
  id?: number | null;
  isDryRun?: boolean;
}

export interface WordPressSyncErrorResult {
  title: string;
  slug: string;
  error: string;
}

export interface WordPressSyncSummary {
  updated: WordPressSyncItemResult[];
  created: WordPressSyncItemResult[];
  failed: WordPressSyncErrorResult[];
  skippedCount: number;
  totalProcessed: number;
  isDryRun?: boolean;
}

export function formatWordPressSyncSummary(summary: WordPressSyncSummary): string {
  const { updated, created, failed, skippedCount, totalProcessed, isDryRun } = summary;
  const changedCount = updated.length + created.length;
  const lines: string[] = [];

  lines.push('='.repeat(60));
  lines.push(`📊 WordPress Sync Summary${isDryRun ? ' (DRY RUN)' : ''}`);
  lines.push('='.repeat(60));

  if (changedCount === 0 && failed.length === 0) {
    lines.push(`✨ All ${totalProcessed} post(s) are up to date! (0 modified)`);
  } else {
    const verb = isDryRun ? 'Would process' : 'Processed';
    const failedPart = failed.length > 0 ? `, ${failed.length} failed` : '';
    lines.push(
      `✨ ${verb} ${changedCount} post(s) (${updated.length} updated, ${created.length} created), ${skippedCount} post(s) skipped (unchanged)${failedPart}.`
    );

    if (updated.length > 0) {
      lines.push(`\n📝 Updated Posts (${updated.length}):`);
      for (const p of updated) {
        const idStr = p.id ? `, ID: ${p.id}` : '';
        const tag = isDryRun ? '[DRY RUN UPDATE]' : '[UPDATED]';
        lines.push(`  • 🔄 ${tag} "${p.title}" (slug: ${p.slug}${idStr})`);
      }
    }

    if (created.length > 0) {
      lines.push(`\n🆕 Created Posts (${created.length}):`);
      for (const p of created) {
        const idStr = p.id ? `, ID: ${p.id}` : '';
        const tag = isDryRun ? '[DRY RUN CREATE]' : '[CREATED]';
        lines.push(`  • 🆕 ${tag} "${p.title}" (slug: ${p.slug}${idStr})`);
      }
    }
  }

  if (failed.length > 0) {
    lines.push(`\n❌ Failed Posts (${failed.length}):`);
    for (const f of failed) {
      lines.push(`  • ❌ "${f.title}" (slug: ${f.slug}): ${f.error}`);
    }
  }

  lines.push('='.repeat(60));
  return lines.join('\n');
}
