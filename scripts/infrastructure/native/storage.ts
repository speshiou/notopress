import { assertOperationPlanFingerprint } from '../../core/publishing/operation-plan';
import { createAwsStoragePlan, normalizeAwsPreview } from '../../core/storage/aws-cli-plan';
import { getStorageConnection } from './storage-config';
import { prepareStorageArtifacts, type NativeStorageBuildInput } from './storage-artifacts';
import { createVaultStorageFiles } from './vault-inventory';
import { createStorageSnapshot } from './storage-snapshot';
import { buildS3SyncArgs } from './s3-sync';
import { runAwsCli, type AwsCliRunner } from './aws-cli';
import { DEFAULT_REGISTRY_FILENAME } from '../../../src/lib/constants';

export function createNativeSitePreparation({ resolveConnection = getStorageConnection, createFiles = createVaultStorageFiles,
  snapshot = createStorageSnapshot, runCli = runAwsCli, environment = process.env, logger = console,
}: {
  resolveConnection?: typeof getStorageConnection;
  createFiles?: typeof createVaultStorageFiles;
  snapshot?: typeof createStorageSnapshot;
  runCli?: AwsCliRunner;
  environment?: NodeJS.ProcessEnv;
  logger?: Pick<typeof console, 'log'>;
} = {}) {
  return async function prepareNativeSite(input: NativeStorageBuildInput & { deleteRemoteFiles: boolean; verbose: boolean }) {
    const { site, registry, deleteRemoteFiles, verbose, stageTimer } = input;
    const connection = resolveConnection({ site, registry });
    const prepared = await prepareStorageArtifacts({ input, files: createFiles({ vaultPath: site.vaultPath }) });
    const staged = await stageTimer.measure({ stage: 'storage.snapshot', run: () => snapshot({ vaultPath: site.vaultPath, artifacts: prepared.artifacts }) });
    const cliEnvironment: NodeJS.ProcessEnv = {
      ...environment, AWS_ACCESS_KEY_ID: connection.credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: connection.credentials.secretAccessKey,
      AWS_CONFIG_FILE: staged.configPath, AWS_PROFILE: 'default', AWS_DEFAULT_PROFILE: 'default',
      AWS_DEFAULT_REGION: environment.AWS_REGION || environment.AWS_DEFAULT_REGION || 'auto',
      AWS_RETRY_MODE: 'standard', AWS_MAX_ATTEMPTS: '1', AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off',
    };
    const args = (dryRun: boolean) => buildS3SyncArgs({ vaultPath: staged.snapshotPath, target: connection.target, deleteRemoteFiles, dryRun, verbose });
    async function preview() {
      const output = await runCli({ args: args(true), environment: cliEnvironment });
      return normalizeAwsPreview({ output, snapshotPath: staged.snapshotPath });
    }
    try {
      logger.log('\nVault backup/sync: comparing the full eligible vault with AWS CLI (size and modification time).');
      const changes = await stageTimer.measure({ stage: 'storage.compare', run: preview });
      const plan = createAwsStoragePlan({ target: connection.target, artifacts: prepared.artifacts, deleteRemoteFiles, preview: changes });
      logger.log(`AWS CLI storage plan ${plan.fingerprint}: ${changes.length} proposed change(s), plus the sanitized registry upload.`);
      for (const line of changes) logger.log(`  storage-preview: ${line}`);
      return {
        plan,
        async apply({ dryRun }: { dryRun: boolean }) {
          if (dryRun) return;
          for (const artifact of prepared.artifacts) if (artifact.verify) await artifact.verify();
          await staged.verify();
          const fresh = createAwsStoragePlan({ target: connection.target, artifacts: prepared.artifacts, deleteRemoteFiles, preview: await stageTimer.measure({ stage: 'storage.recheck', run: preview }) });
          assertOperationPlanFingerprint({ label: 'AWS CLI storage', plan: fresh, expectedFingerprint: plan.fingerprint });
          await prepared.materialize();
          await stageTimer.measure({ stage: 'storage.sync', run: async () => {
            const output = await runCli({ args: args(false), environment: cliEnvironment });
            if (verbose) for (const line of normalizeAwsPreview({ output, snapshotPath: staged.snapshotPath })) logger.log(`  storage-result: ${line}`);
            await runCli({ args: ['s3', 'cp', staged.registryPath, `s3://${connection.target.bucket}/${DEFAULT_REGISTRY_FILENAME}`, '--endpoint-url', connection.target.endpoint, '--only-show-errors'], environment: cliEnvironment });
          } });
          logger.log('Vault backup/sync completed with AWS CLI.');
        },
        close: staged.close,
      };
    } catch (error: unknown) {
      await staged.close();
      throw error;
    }
  };
}

export const prepareNativeSite = createNativeSitePreparation();
