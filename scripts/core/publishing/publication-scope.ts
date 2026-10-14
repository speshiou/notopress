import type { OperationPlan } from './operation-plan';
import type { StorageOperation } from '../storage/publication';

export function formatPublicationScope({ publisherId, targetSlugs, storagePlan, dryRun }: {
  publisherId?: string;
  targetSlugs?: readonly string[];
  storagePlan: OperationPlan<StorageOperation>;
  dryRun: boolean;
}): string {
  const lines = [
    `Destination scope (${dryRun ? 'DRY RUN: proposed changes only' : 'LIVE: planned changes before apply'})`,
    publisherId ? `Target-site publication via adapter: ${publisherId}` : 'Target-site publication: none; no adapter posts are changed.',
  ];
  if (publisherId) {
    if (targetSlugs?.length) {
      lines.push(`Adapter selection: ${targetSlugs.length} requested source slug(s):`, ...targetSlugs.map((slug) => `  ${slug}`));
    } else lines.push('Adapter selection: site-wide changed documents.');
  }
  const state = storagePlan.operations.find((operation) => operation.action === 'state');
  const destination = state ? `; bucket ${state.target.bucket}; site prefix ${state.target.siteId}/` : '';
  lines.push(`Vault backup/sync (S3/R2): full eligible vault and generated site outputs${destination}.`);
  lines.push('Selected slugs limit adapter posts only; storage uploads do not create adapter posts.');
  return lines.join('\n');
}
