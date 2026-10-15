import { assertOperationPlanFingerprint } from '../../core/publishing/operation-plan';
import { createAwsStoragePlan, normalizeAwsPreview } from '../../core/storage/aws-cli-plan';
import { getStorageConnection } from './storage-config';
import { prepareStorageArtifacts, type NativeStorageBuildInput } from './storage-artifacts';
import { createVaultStorageFiles } from './storage-files';
import { createStorageSnapshot } from './storage-snapshot';
import { buildS3SyncArgs } from './s3-sync';
import { runAwsCli, type AwsCliRunner } from './aws-cli';
import { DEFAULT_REGISTRY_FILENAME } from '../../../src/lib/constants';
import { createVaultFullSyncHistory } from './full-sync-history';

export function createNativeSitePreparation({ resolveConnection = getStorageConnection, createFiles = createVaultStorageFiles,
  snapshot = createStorageSnapshot, runCli = runAwsCli, environment = process.env, logger = console,
  createHistory = createVaultFullSyncHistory,
}: {
  resolveConnection?: typeof getStorageConnection;
  createFiles?: typeof createVaultStorageFiles;
  snapshot?: typeof createStorageSnapshot;
  runCli?: AwsCliRunner;
  environment?: NodeJS.ProcessEnv;
  logger?: Pick<typeof console, 'log'>;
  createHistory?: typeof createVaultFullSyncHistory;
} = {}) {
  return async function prepareNativeSite(input: NativeStorageBuildInput & { deleteRemoteFiles: boolean; verbose: boolean; remindFullSync?: boolean }) {
    const { site, registry, deleteRemoteFiles, verbose, stageTimer } = input;
    const assetsOnly = input.scope?.kind === 'assets';
    const incremental = assetsOnly || input.scope?.kind === 'incremental';
    if (incremental && deleteRemoteFiles) throw new Error('Incremental publishing cannot delete remote objects. Use sync --delete with a reviewed plan.');
    const connection = resolveConnection({ site, registry });
    const history = createHistory({ vaultPath: site.vaultPath });
    if (!assetsOnly) logger.log(await history.describe({ target: connection.target, remind: input.remindFullSync === true }));
    const prepared = await prepareStorageArtifacts({ input, files: createFiles({ vaultPath: site.vaultPath }) });
    const staged = await stageTimer.measure({ stage: 'storage.snapshot', run: () => snapshot({ vaultPath: site.vaultPath, artifacts: prepared.artifacts }) });
    const cliEnvironment: NodeJS.ProcessEnv = {
      ...environment, AWS_ACCESS_KEY_ID: connection.credentials.accessKeyId, AWS_SECRET_ACCESS_KEY: connection.credentials.secretAccessKey,
      AWS_CONFIG_FILE: staged.configPath, AWS_PROFILE: 'default', AWS_DEFAULT_PROFILE: 'default',
      AWS_DEFAULT_REGION: environment.AWS_REGION || environment.AWS_DEFAULT_REGION || 'auto',
      AWS_RETRY_MODE: 'standard', AWS_MAX_ATTEMPTS: '1', AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off',
    };
    const args = (dryRun: boolean) => buildS3SyncArgs({ vaultPath: staged.snapshotPath, target: connection.target, deleteRemoteFiles, dryRun, verbose, incremental });
    async function preview() {
      const output = await runCli({ args: args(true), environment: cliEnvironment });
      return normalizeAwsPreview({ output, snapshotPath: staged.snapshotPath });
    }
    try {
      logger.log(incremental
        ? `\n${assetsOnly ? 'Adapter assets' : 'Native distribution'}: preparing explicit AWS CLI uploads without remote listing. Required files are uploaded even if already present.`
        : '\nFull distribution sync: comparing all distribution files with AWS CLI (size and modification time).');
      const changes = await stageTimer.measure({ stage: 'storage.compare', run: preview });
      const plan = createAwsStoragePlan({ target: connection.target, artifacts: prepared.artifacts, deleteRemoteFiles, preview: changes, incremental, assetsOnly });
      logger.log(`AWS CLI storage plan ${plan.fingerprint}: ${changes.length} proposed change(s), ${assetsOnly ? 'no native registry upload' : 'plus the sanitized registry upload'}.`);
      for (const line of changes) logger.log(`  storage-preview: ${line}`);
      return {
        plan,
        async apply({ dryRun }: { dryRun: boolean }) {
          if (dryRun) return;
          await prepared.verifySources();
          for (const artifact of prepared.artifacts) if (artifact.verify) await artifact.verify();
          await staged.verify();
          const fresh = createAwsStoragePlan({ target: connection.target, artifacts: prepared.artifacts, deleteRemoteFiles, preview: await stageTimer.measure({ stage: 'storage.recheck', run: preview }), incremental, assetsOnly });
          assertOperationPlanFingerprint({ label: 'AWS CLI storage', plan: fresh, expectedFingerprint: plan.fingerprint });
          await prepared.materialize();
          await stageTimer.measure({ stage: 'storage.sync', run: async () => {
            const output = await runCli({ args: args(false), environment: cliEnvironment });
            if (verbose) for (const line of normalizeAwsPreview({ output, snapshotPath: staged.snapshotPath })) logger.log(`  storage-result: ${line}`);
            if (!assetsOnly) await runCli({ args: ['s3', 'cp', staged.registryPath, `s3://${connection.target.bucket}/${DEFAULT_REGISTRY_FILENAME}`, '--endpoint-url', connection.target.endpoint, '--only-show-errors'], environment: cliEnvironment });
          } });
          logger.log(incremental ? 'Incremental distribution upload completed with AWS CLI.' : 'Full distribution sync completed with AWS CLI.');
          if (!incremental) try {
            await history.record({ target: connection.target });
          } catch {
            logger.log('Storage sync succeeded, but its completion time could not be saved. A later run may still show a full-sync reminder.');
          }
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
