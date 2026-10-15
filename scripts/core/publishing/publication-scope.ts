import type { OperationPlan } from './operation-plan';
import type { AwsStorageOperation } from '../storage/aws-cli-plan';

export function formatPublicationScope({ publisherId, targetSlugs, storagePlan, dryRun }: {
  publisherId?: string;
  targetSlugs?: readonly string[];
  storagePlan: OperationPlan<AwsStorageOperation>;
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
  const state = storagePlan.operations.find((operation) => operation.action === 'sync' || operation.action === 'upload-distribution');
  const destination = state ? `; bucket ${state.target.bucket}; site prefix ${state.target.siteId}/` : '';
  if (state?.action === 'upload-distribution') {
    lines.push(state.assetsOnly
      ? `Adapter asset distribution (S3/R2): only adapter-declared assets; no native HTML, indexes or sitemaps${destination}.`
      : `Incremental distribution (S3/R2): the complete native output set, including HTML, indexes, sitemaps and assets${destination}; no remote listing.`);
  } else lines.push(`Full distribution sync (S3/R2): all generated native-site outputs and distribution assets${destination}.`);
  lines.push('Source Markdown stays in Git. Storage uploads do not create adapter posts. Use sync for full native distribution reconciliation.');
  return lines.join('\n');
}
