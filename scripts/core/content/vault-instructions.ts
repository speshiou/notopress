import { computeContentHash } from '../state/sync-state';
import { createOperationPlan } from '../publishing/operation-plan';

export const VAULT_INSTRUCTIONS_FILENAME = 'AGENTS.md';
export const INSTRUCTIONS_BEGIN = '<!-- BEGIN:notopress-vault-agent-rules -->';
export const INSTRUCTIONS_END = '<!-- END:notopress-vault-agent-rules -->';

export function prepareVaultInstructionsPlan({ existingContent, template }: {
  existingContent: string | null;
  template: string;
}) {
  const existing = existingContent ?? '';
  const block = `${INSTRUCTIONS_BEGIN}\n${template.trim()}\n${INSTRUCTIONS_END}`;
  const start = existing.indexOf(INSTRUCTIONS_BEGIN);
  const end = existing.indexOf(INSTRUCTIONS_END);
  let content: string;
  if (start === -1 && end === -1) {
    content = `${existing}${existing ? (existing.endsWith('\n') ? '\n' : '\n\n') : ''}${block}\n`;
  } else {
    if (start === -1 || end < start
      || existing.indexOf(INSTRUCTIONS_BEGIN, start + INSTRUCTIONS_BEGIN.length) !== -1
      || existing.indexOf(INSTRUCTIONS_END, end + INSTRUCTIONS_END.length) !== -1) {
      throw new Error('Malformed NotoPress managed block in AGENTS.md. Repair its markers before updating; owner instructions were left unchanged.');
    }
    content = existing.slice(0, start) + block + existing.slice(end + INSTRUCTIONS_END.length);
  }
  const changed = content !== existing;
  const plan = createOperationPlan({
    kind: 'notopress-vault-instructions',
    operations: changed ? [{
      action: 'update-managed-instructions', path: VAULT_INSTRUCTIONS_FILENAME,
      previousHash: existingContent === null ? null : computeContentHash(existing),
      contentHash: computeContentHash(content),
      managedBlock: block,
    }] : [],
    serializeOperation: (operation) => operation,
  });
  return { plan, content, changed };
}
