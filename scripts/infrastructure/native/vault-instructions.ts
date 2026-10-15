import { lstat, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { prepareVaultInstructionsPlan, VAULT_INSTRUCTIONS_FILENAME } from '../../core/content/vault-instructions';
import { assertOperationPlanFingerprint, formatOperationPlan } from '../../core/publishing/operation-plan';

const nativeDependencies = {
  read: async (file: string): Promise<string | null> => {
    try {
      if (!(await lstat(file)).isFile()) throw new Error('Vault AGENTS.md must be a regular file, not a symbolic link.');
      return await readFile(file, 'utf8');
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  },
  readTemplate: () => readFile(new URL('../../core/content/vault-instructions.md', import.meta.url), 'utf8'),
  write: async ({ file, content }: { file: string; content: string }): Promise<void> => {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { flag: 'wx' });
      await rename(temporary, file);
    } finally { await rm(temporary, { force: true }); }
  },
};

export function createVaultInstructionPreparation({ dependencies = nativeDependencies, logger = console }: {
  dependencies?: typeof nativeDependencies;
  logger?: Pick<typeof console, 'log'>;
} = {}) {
  return async ({ vaultPath }: { vaultPath: string }) => {
    const file = path.join(vaultPath, VAULT_INSTRUCTIONS_FILENAME);
    async function prepare() {
      return prepareVaultInstructionsPlan({ existingContent: await dependencies.read(file), template: await dependencies.readTemplate() });
    }
    const prepared = await prepare();
    return {
      plan: prepared.plan,
      async apply({ dryRun }: { dryRun: boolean }) {
        if (!prepared.changed) return;
        if (dryRun) {
          logger.log(formatOperationPlan({ label: 'Vault instruction update', plan: prepared.plan, serializeOperation: (operation) => operation }));
          logger.log('[DRY RUN] NotoPress instructions in vault AGENTS.md are outdated. Would update during a live run; no files changed.');
          return;
        }
        const fresh = await prepare();
        assertOperationPlanFingerprint({ label: 'Vault instructions', plan: fresh.plan, expectedFingerprint: prepared.plan.fingerprint });
        await dependencies.write({ file, content: prepared.content });
        logger.log('Updated NotoPress instructions in vault AGENTS.md. Read the updated block before continuing.');
      },
    };
  };
}

export const prepareVaultInstructions = createVaultInstructionPreparation();
export type PreparedVaultInstructions = Awaited<ReturnType<typeof prepareVaultInstructions>>;
