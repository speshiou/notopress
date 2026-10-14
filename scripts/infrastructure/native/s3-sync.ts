import type { StorageTarget } from '../../core/storage/target';

export function buildS3SyncArgs({ vaultPath, target, deleteRemoteFiles, dryRun, verbose = false, incremental = false }: {
  vaultPath: string;
  target: StorageTarget;
  deleteRemoteFiles: boolean;
  dryRun: boolean;
  verbose?: boolean;
  incremental?: boolean;
}): string[] {
  if (incremental && deleteRemoteFiles) throw new Error('Incremental publishing cannot delete remote objects. Use sync --delete.');
  const args = ['s3', incremental ? 'cp' : 'sync', `${vaultPath}/`, `s3://${target.bucket}/${target.siteId}/`,
    '--endpoint-url', target.endpoint, '--no-follow-symlinks',
    '--exclude', '*.DS_Store', '--exclude', '*/.git/*', '--exclude', '.git/*',
    '--exclude', '.notopress/*', '--exclude', '*/.notopress/*',
  ];
  if (incremental) args.push('--recursive');
  if (deleteRemoteFiles) args.push('--delete');
  args.push(...(dryRun ? ['--dryrun', '--no-progress'] : verbose ? ['--no-progress'] : ['--only-show-errors']));
  return args;
}
