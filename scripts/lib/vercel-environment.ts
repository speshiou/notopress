import { type EnvMetadata } from '../../src/lib/env';

type VercelCommandResult = {
  status: number | null;
  error?: Error;
  stderr: string;
};

type RunVercelCommand = ({
  args,
  env,
}: {
  args: string[];
  env: NodeJS.ProcessEnv;
}) => Promise<VercelCommandResult>;

type VercelEnvironmentSynchronizerDeps = {
  runCommand: RunVercelCommand;
  log: (message: string) => void;
  warn: (message: string) => void;
};

type SyncVercelEnvironmentInput = {
  variables: Record<string, string | undefined>;
  metadata: Record<string, EnvMetadata>;
  commandEnv: NodeJS.ProcessEnv;
};

export function createVercelEnvironmentSynchronizer({
  runCommand,
  log,
  warn,
}: VercelEnvironmentSynchronizerDeps) {
  return async function syncVercelEnvironment({
    variables,
    metadata,
    commandEnv,
  }: SyncVercelEnvironmentInput): Promise<void> {
    for (const [key, value] of Object.entries(variables)) {
      if (!value) {
        warn(`⚠️  Warning: ${key} is missing, skipping.`);
        continue;
      }

      const variableMetadata = metadata[key];
      if (!variableMetadata) {
        throw new Error(`Missing metadata for environment variable: ${key}`);
      }

      log(`  Syncing ${key}... (Sensitive: ${variableMetadata.isSensitive})`);
      const sensitivityFlag = variableMetadata.isSensitive ? '--sensitive' : '--no-sensitive';
      const result = await runCommand({
        args: [
          'env',
          'add',
          key,
          'production',
          '--force',
          '--value',
          value,
          '--yes',
          '--non-interactive',
          sensitivityFlag,
        ],
        env: commandEnv,
      });

      if (result.error) throw result.error;
      if (result.status !== 0) {
        const detail = result.stderr.trim();
        throw new Error(
          `Failed to synchronize Vercel environment variable ${key} (status ${result.status ?? 'unknown'})${
            detail ? `: ${detail}` : '.'
          }`
        );
      }

      log(`✅ ${key} synchronized${variableMetadata.isSensitive ? ' (as sensitive)' : ''}.`);
    }
  };
}
