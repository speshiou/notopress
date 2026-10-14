import { INDEX_JSON, ROOT_JSON, RENDERED_DIR, THUMBNAILS_DIR, NOTOPRESS_DIR, SITEMAP_XML, SITEMAP_PAGES_XML } from '../../../src/lib/constants';
import { SYNC_STATE_FILENAME, computeContentHash } from '../state/sync-state';
import { createOperationPlan } from '../publishing/operation-plan';

export const SOURCE_GITIGNORE_FILENAME = '.gitignore';
const ignoredPaths = [`${RENDERED_DIR}/`, `**/${THUMBNAILS_DIR}/`, `/${ROOT_JSON}`, `/content/**/${INDEX_JSON}`,
  `/public/**/${SITEMAP_XML}`, `/public/**/${SITEMAP_PAGES_XML}`, `${NOTOPRESS_DIR}/`, SYNC_STATE_FILENAME,
  '.DS_Store', '.env', '.env.*', '!.env.example', '/registry.json'];

export function prepareSourceRepositoryPlan({ gitExists, ignoreContent }: { gitExists: boolean; ignoreContent: string | null }) {
  const existing = ignoreContent || '';
  const lines = new Set(existing.split(/\r?\n/));
  const missing = ignoredPaths.filter((line) => !lines.has(line));
  const content = missing.length ? `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}\n# NotoPress generated distribution and local state\n${missing.join('\n')}\n` : existing;
  const plan = createOperationPlan({ kind: 'notopress-source-git', operations: [
    { action: 'initialize-git', required: !gitExists },
    { action: 'write-gitignore', path: SOURCE_GITIGNORE_FILENAME, previousHash: ignoreContent === null ? null : computeContentHash(ignoreContent), contentHash: computeContentHash(content) },
  ], serializeOperation: (operation) => operation });
  return { plan, content };
}
