export function buildS3SyncArgs({
  vaultPath,
  bucketName,
  siteId,
  endpoint,
  deleteRemoteFiles,
  dryRun,
}: {
  vaultPath: string;
  bucketName: string;
  siteId: string;
  endpoint: string;
  deleteRemoteFiles: boolean;
  dryRun: boolean;
}): string[] {
  const args = [
    's3',
    'sync',
    `${vaultPath}/`,
    `s3://${bucketName}/${siteId}/`,
    '--endpoint-url',
    endpoint,
    '--size-only',
    '--exclude',
    '*.DS_Store',
    '--exclude',
    '*/.git/*',
    '--exclude',
    '.git/*',
  ];

  if (deleteRemoteFiles) {
    args.push('--delete');
  }

  if (dryRun) {
    args.push('--dryrun');
  }

  return args;
}
