import type { StorageTarget } from '../../core/storage/target';

export function buildS3SyncArgs({ vaultPath, target, deleteRemoteFiles, dryRun, verbose = false }: {
  vaultPath: string;
  target: StorageTarget;
  deleteRemoteFiles: boolean;
  dryRun: boolean;
  verbose?: boolean;
}): string[] {
  const args = ['s3', 'sync', `${vaultPath}/`, `s3://${target.bucket}/${target.siteId}/`,
    '--endpoint-url', target.endpoint, '--no-follow-symlinks',
    '--exclude', '*.DS_Store', '--exclude', '*/.git/*', '--exclude', '.git/*',
    '--exclude', '.notopress/*', '--exclude', '*/.notopress/*',
  ];
  if (deleteRemoteFiles) args.push('--delete');
  args.push(...(dryRun ? ['--dryrun', '--no-progress'] : verbose ? ['--no-progress'] : ['--only-show-errors']));
  return args;
}
