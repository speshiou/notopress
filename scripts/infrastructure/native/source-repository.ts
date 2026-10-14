import { access, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { prepareSourceRepositoryPlan, SOURCE_GITIGNORE_FILENAME } from '../../core/content/source-repository';
import { assertOperationPlanFingerprint } from '../../core/publishing/operation-plan';

const nativeDependencies = {
  exists: async (file: string) => { try { await access(file); return true; } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  } },
  read: (file: string) => readFile(file, 'utf8'),
  write: ({ file, content }: { file: string; content: string }) => writeFile(file, content, 'utf8'),
  initialize: (directory: string): Promise<void> => new Promise((resolve, reject) => {
    execFile('git', ['init', '--', directory], { shell: false }, (error) => error ? reject(new Error('Could not initialize source Git repository. Check the Git installation.')) : resolve());
  }),
};

export function createSourceRepositoryPreparation({ dependencies = nativeDependencies }: { dependencies?: typeof nativeDependencies } = {}) {
  return async ({ vaultPath }: { vaultPath: string }) => {
    const ignoreFile = path.join(vaultPath, SOURCE_GITIGNORE_FILENAME);
    async function prepare() {
      return prepareSourceRepositoryPlan({ gitExists: await dependencies.exists(path.join(vaultPath, '.git')),
        ignoreContent: await dependencies.exists(ignoreFile) ? await dependencies.read(ignoreFile) : null,
      });
    }
    const prepared = await prepare();
    return {
      plan: prepared.plan,
      async apply({ dryRun }: { dryRun: boolean }) {
        if (dryRun) return;
        const fresh = await prepare();
        assertOperationPlanFingerprint({ label: 'Source Git initialization', plan: fresh.plan, expectedFingerprint: prepared.plan.fingerprint });
        if (prepared.plan.operations.some((operation) => operation.action === 'initialize-git' && operation.required)) await dependencies.initialize(vaultPath);
        const previous = await dependencies.exists(ignoreFile) ? await dependencies.read(ignoreFile) : null;
        if (previous !== prepared.content) await dependencies.write({ file: ignoreFile, content: prepared.content });
      },
    };
  };
}

export const prepareSourceRepository = createSourceRepositoryPreparation();
