import { select } from '@inquirer/prompts';
import { readFile, writeFile, unlink } from 'fs/promises';
import { spawn, SpawnOptions } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getRegistry } from './lib/registry';
import { env, ENV_KEYS, ENV_METADATA } from '../src/lib/env';
import { hasFlag, getFlagValue } from '../src/lib/cli';
import { Registry, Site } from '../src/domain/registry';
import { normalizeThumbnailSizes } from '../src/lib/responsive-images';
import { exists } from './lib/files';
import { generateIndices } from './lib/indices';
import { generateSitemaps } from './lib/sitemaps';
import { pushToWordPress, pullFromWordPress } from './lib/wordpress';
import { ensureVaultAgentRules } from './lib/agent-rules';
import { generateRenderedContent } from './lib/rendered-content';
import { createVercelEnvironmentSynchronizer } from './lib/vercel-environment';
import { buildS3SyncArgs } from './lib/s3-sync';
import { buildContentSnapshot } from './lib/content-snapshot';

type RunMode = 'sync' | 'deploy' | 'configure';

const VERCEL_CONFIG_PATH = 'vercel.json';

async function execAsync({
  command,
  args,
  options,
}: {
  command: string;
  args: string[];
  options: SpawnOptions;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    // shell: false is more secure and robust against special characters
    const child = spawn(command, args, { ...options, shell: false });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command "${command} ${args.join(' ')}" failed with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
}

async function selectSite({
  registry,
  mode,
  siteId,
}: {
  registry: Registry;
  mode: RunMode;
  siteId?: string;
}): Promise<Site> {
  if (registry.sites.length === 0) {
    console.error('⨯ Error: No sites found in registry.json');
    process.exit(1);
  }

  const actionLabel = mode === 'sync' ? 'sync using AWS CLI' : mode === 'configure' ? 'configure locally' : 'sync and deploy';

  const selectedSiteId =
    siteId ||
    (await select({
      message: `Select a site to ${actionLabel}:`,
      choices: registry.sites.map((site) => ({
        name: `${site.siteId} (${site.domain || 'no domain'})`,
        value: site.siteId,
        description:
          mode === 'configure'
            ? `Project ID: ${site.vercelProjectId || 'Not configured'}`
            : `Vault: ${site.vaultPath} -> Bucket: ${site.bucketName || 'Not configured'}`,
      })),
    }));

  const site = registry.sites.find((s) => s.siteId === selectedSiteId);
  if (!site) {
    console.error(`⨯ Site "${selectedSiteId}" not found in registry.json`);
    process.exit(1);
  }

  if (mode === 'configure') {
    return site;
  }

  if (!site.bucketName) {
    console.error(`⨯ Error: "bucketName" is not configured for site [${site.siteId}] in registry.json`);
    process.exit(1);
  }

  if (!(await exists(site.vaultPath))) {
    console.error(`⨯ Error: The local vaultPath does not exist: ${site.vaultPath}`);
    process.exit(1);
  }

  return site;
}

function getEndpoint({ site, registry }: { site: Site; registry: Registry }): string | undefined {
  return site.endpoint || registry.endpoint || env.S3_ENDPOINT;
}

function getS3Credentials({ registry }: { registry: Registry }) {
  return {
    accessKeyId: registry.accessKeyId || env.S3_ACCESS_KEY_ID,
    secretAccessKey: registry.secretAccessKey || env.S3_SECRET_ACCESS_KEY,
  };
}

async function syncSite({
  site,
  registry,
  isDryRun,
  deleteRemoteFiles,
  verbose,
}: {
  site: Site;
  registry: Registry;
  isDryRun: boolean;
  deleteRemoteFiles: boolean;
  verbose: boolean;
}) {
  const endpoint = getEndpoint({ site, registry });
  const { accessKeyId, secretAccessKey } = getS3Credentials({ registry });
  const bucketName = site.bucketName;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error(
      '⨯ Error: Missing S3 credentials. Please provide them in registry.json or via environment variables (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).'
    );
    process.exit(1);
  }

  if (!bucketName) {
    throw new Error(`⨯ Error: "bucketName" is not configured for site [${site.siteId}].`);
  }

  console.log(`\n☁️  Preparing AWS S3 Sync...`);
  console.log(`- Local Path: ${site.vaultPath}`);
  console.log(`- S3 Bucket:  ${bucketName}`);
  console.log(`- Endpoint:   ${endpoint}\n`);

  // We add a trailing slash to the vaultPath so that aws s3 sync syncs the *contents* of the directory
  // and not the directory itself.
  // Each site is synced to its own subdirectory in the bucket: /{site-id}/*
  // We include '--size-only' to skip uploading existing image assets and thumbnails whose size matches
  // the remote object, avoiding redundant uploads when local modification timestamps change (#38).
  const args = buildS3SyncArgs({
    vaultPath: site.vaultPath,
    bucketName,
    siteId: site.siteId,
    endpoint,
    deleteRemoteFiles,
    dryRun: isDryRun,
    verbose,
  });

  console.log(`Executing:\n> aws ${args.join(' ')}\n`);

  // stdio: 'inherit' passes the aws-cli output directly to our terminal
  await execAsync({
    command: 'aws',
    args,
    options: {
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: accessKeyId,
        AWS_SECRET_ACCESS_KEY: secretAccessKey,
      },
    },
  });
  console.log(isDryRun ? '✅ S3 sync preview completed.' : '✅ S3 sync completed.');
}

async function uploadRegistry({ site, registry }: { site: Site; registry: Registry }) {
  const endpoint = getEndpoint({ site, registry });
  const { accessKeyId, secretAccessKey } = getS3Credentials({ registry });

  if (!endpoint || !accessKeyId || !secretAccessKey) return;

  console.log('\n✨ Uploading sanitized registry.json to bucket root...');

  // Sanitize registry: remove sensitive credentials and local vault paths
  const sanitizedSites = registry.sites
    .filter((s) => s.bucketName === site.bucketName)
    .map((s) => ({
      domain: s.domain,
      siteId: s.siteId,
      // vaultPath is omitted or can be a placeholder
    }));

  const sanitizedRegistry = {
    sites: sanitizedSites,
  };

  const registryTmpPath = join(tmpdir(), `notopress-registry-${randomUUID()}.json`);
  try {
    await writeFile(registryTmpPath, JSON.stringify(sanitizedRegistry, null, 2));

    const args = [
      's3',
      'cp',
      registryTmpPath,
      `s3://${site.bucketName}/registry.json`,
      '--endpoint-url',
      endpoint,
      '--only-show-errors',
    ];

    await execAsync({
      command: 'aws',
      args,
      options: {
        stdio: 'inherit',
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: accessKeyId,
          AWS_SECRET_ACCESS_KEY: secretAccessKey,
        },
      },
    });
  } finally {
    if (await exists(registryTmpPath)) {
      await unlink(registryTmpPath);
    }
  }
}

function getVercelProjectId({ site }: { site: Site }): string {
  return site.vercelProjectId || site.siteId;
}

function getDeploymentEnvVars({ site, registry }: { site: Site; registry: Registry }): Record<string, string | undefined> {
  return {
    [ENV_KEYS.S3_ACCESS_KEY_ID]: registry.accessKeyId,
    [ENV_KEYS.S3_SECRET_ACCESS_KEY]: registry.secretAccessKey,
    [ENV_KEYS.S3_ENDPOINT]: getEndpoint({ site, registry }),
    [ENV_KEYS.S3_BUCKET]: site.bucketName,
    [ENV_KEYS.VAULT_ROOT]: site.siteId,
  };
}

function getVercelCommandEnv({ projectId }: { projectId: string }): NodeJS.ProcessEnv {
  return { ...process.env, VERCEL_PROJECT_ID: projectId };
}

async function ensureVercelCli() {
  try {
    await execAsync({
      command: 'vercel',
      args: ['--version'],
      options: { stdio: 'ignore' },
    });
  } catch {
    console.error('⨯ Error: Vercel CLI is not installed or not in PATH.');
    console.error('  Please install it with: npm install -g vercel');
    process.exit(1);
  }
}

async function configureLocalEnvironment({ site, registry }: { site: Site; registry: Registry }) {
  const envVars = getDeploymentEnvVars({ site, registry });

  console.log(`\n🛠️  Updating .env.local for ${site.siteId}...`);

  let envContent = '';
  try {
    envContent = await readFile('.env.local', 'utf-8');
  } catch {
    // .env.local is optional.
  }

  const existingVars: Record<string, string> = {};
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      existingVars[key.trim()] = valueParts.join('=').trim();
    }
  }

  const finalVars = { ...existingVars, ...envVars };
  const newContent = Object.entries(finalVars)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  await writeFile('.env.local', newContent);
  console.log('✅ .env.local updated successfully.');
  console.log('\n✨ Local development context switched. Restart npm run dev to see changes.');
}

async function syncVercelEnvironment({ site, registry }: { site: Site; registry: Registry }) {
  const vercelProjectId = getVercelProjectId({ site });
  const envVars = getDeploymentEnvVars({ site, registry });

  console.log(`\n📡 Synchronizing environment variables to Vercel...`);
  const synchronize = createVercelEnvironmentSynchronizer({
    runCommand: ({ args, env: commandEnv }) => new Promise((resolve) => {
      const child = spawn('vercel', args, {
        shell: false,
        stdio: ['ignore', 'inherit', 'pipe'],
        env: commandEnv,
      });
      let stderr = '';
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        process.stderr.write(data);
      });
      child.on('close', (status) => resolve({ status, stderr }));
      child.on('error', (error) => resolve({ status: null, error, stderr }));
    }),
    log: console.log,
    warn: console.warn,
  });
  await synchronize({
    variables: envVars,
    metadata: ENV_METADATA,
    commandEnv: getVercelCommandEnv({ projectId: vercelProjectId }),
  });
}

async function deployToVercel({ site }: { site: Site }) {
  const vercelProjectId = getVercelProjectId({ site });

  console.log(`\n📦 Triggering production deployment...`);
  await execAsync({
    command: 'vercel',
    args: ['deploy', '--prod', '--local-config', VERCEL_CONFIG_PATH],
    options: {
      stdio: 'inherit',
      env: getVercelCommandEnv({ projectId: vercelProjectId }),
    },
  });
  console.log(`\n✨ Deployment successfully triggered!`);
}

async function syncContent({
  site,
  registry,
  isDryRun,
  deleteRemoteFiles,
  verbose,
}: {
  site: Site;
  registry: Registry;
  isDryRun: boolean;
  deleteRemoteFiles: boolean;
  verbose: boolean;
}) {
  const thumbnailSizes = normalizeThumbnailSizes(site.thumbnailSizes || registry.thumbnailSizes);
  await ensureVaultAgentRules({
    vaultPath: site.vaultPath,
    siteId: site.siteId,
    isWordPressEnabled: Boolean(site.wordpress),
    dryRun: isDryRun,
  });

  const { rootContentIndex, vaultRootIndex, allIndices } = await generateIndices({
    vaultPath: site.vaultPath,
    thumbnailSizes,
    noteIncludePaths: site.noteIncludePaths,
    rewrites: site.rewrites,
    dryRun: isDryRun,
    verbose,
  });
  const contentSnapshot = await buildContentSnapshot({ vaultPath: site.vaultPath, allIndices });

  await generateRenderedContent({
    vaultPath: site.vaultPath,
    siteId: site.siteId,
    imageHost: site.imageHost || registry.imageHost,
    allIndices,
    contentSnapshot,
    rootIndex: vaultRootIndex,
    thumbnailSizes,
    noteIncludePaths: site.noteIncludePaths,
    dryRun: isDryRun,
  });

  await generateSitemaps({
    vaultPath: site.vaultPath,
    domain: site.domain,
    rootContentIndex,
    allIndices,
    routes: vaultRootIndex.routes,
    dryRun: isDryRun,
  });

  await syncSite({ site, registry, isDryRun, deleteRemoteFiles, verbose });

  if (!isDryRun) {
    await uploadRegistry({ site, registry });
  }

  return { allIndices, contentSnapshot, vaultRootIndex };
}

function getRunMode(): RunMode {
  if (hasFlag({ flag: '--configure' }) || hasFlag({ flag: '--dev' })) {
    return 'configure';
  }

  if (hasFlag({ flag: '--deploy' })) {
    return 'deploy';
  }

  return 'sync';
}

async function main() {
  const isDryRun = hasFlag({ flag: '--dry-run' });
  const deleteRemoteFiles = hasFlag({ flag: '--delete' });
  const verbose = hasFlag({ flag: '--verbose', alias: '-v' });
  const registryPath = getFlagValue({ flag: '--registry', alias: '-r' });
  const siteId = getFlagValue({ flag: '--site', alias: '-s' });
  const mode = getRunMode();

  try {
    const registry = await getRegistry(registryPath);

    if (isDryRun) {
      console.log('\n🏜️  DRY RUN MODE ENABLED - No changes will be made.');
    }

    const site = await selectSite({ registry, mode, siteId });

    if (mode === 'configure') {
      await configureLocalEnvironment({ site, registry });
      return;
    }

    const hasPullFlag = hasFlag({ flag: '--pull' });
    if (hasPullFlag) {
      const pullSlugOrId = getFlagValue({ flag: '--pull' });
      if (!pullSlugOrId) {
        throw new Error(
          `⨯ Please specify a post slug or ID to pull from WordPress.\n  Example: notopress sync --site ${site.siteId} --pull my-post-slug`
        );
      }

      await pullFromWordPress({
        site,
        registry,
        slugOrId: pullSlugOrId,
        dryRun: isDryRun,
      });
      return;
    }

    const hasPushFlag = hasFlag({ flag: '--push' });
    const markSynced = hasFlag({ flag: '--mark-synced' });
    const shouldPushWp = hasFlag({ flag: '--wp' }) || hasPushFlag || markSynced;
    const forcePush = hasFlag({ flag: '--force' });
    const expectedPlanFingerprint = getFlagValue({ flag: '--expect-wp-plan' });
    if (expectedPlanFingerprint && !/^[a-f0-9]{64}$/.test(expectedPlanFingerprint)) {
      throw new Error('⨯ --expect-wp-plan requires the 64-character fingerprint printed by a WordPress dry-run.');
    }
    if (expectedPlanFingerprint && !shouldPushWp) {
      throw new Error('⨯ --expect-wp-plan requires --wp or --push.');
    }
    if (expectedPlanFingerprint && markSynced) {
      throw new Error('⨯ --expect-wp-plan cannot be combined with --mark-synced.');
    }
    const pushValue = getFlagValue({ flag: '--push' });
    const targetSlugs = pushValue && pushValue !== 'true'
      ? pushValue.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const { allIndices, contentSnapshot, vaultRootIndex } = await syncContent({
      site,
      registry,
      isDryRun,
      deleteRemoteFiles,
      verbose,
    });

    if (shouldPushWp) {
      await pushToWordPress({
        site,
        registry,
        allIndices,
        contentSnapshot,
        rootIndex: vaultRootIndex,
        targetSlugs,
        force: forcePush,
        markSynced,
        expectedPlanFingerprint,
        dryRun: isDryRun,
      });
    }

    if (isDryRun) {
      console.log('\n✅ Dry run completed successfully!');
      return;
    }

    console.log('\n✅ Sync and registry upload successfully completed!');

    if (mode === 'deploy') {
      const vercelProjectId = getVercelProjectId({ site });
      console.log(`\n🚀 Preparing deployment for ${site.domain || site.siteId}...`);
      console.log(`- Site ID: ${site.siteId}`);
      console.log(`- Vercel Project ID: ${vercelProjectId}${site.vercelProjectId ? '' : ' (fallback to siteId)'}`);

      await ensureVercelCli();
      await syncVercelEnvironment({ site, registry });
      await deployToVercel({ site });
    }
  } catch (err: unknown) {
    const action = mode === 'deploy' ? 'Deployment' : mode === 'configure' ? 'Configuration' : isDryRun ? 'Dry run' : 'Sync process';
    console.error(`\n⨯ ${action} failed.`);
    if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error('An unknown error occurred:');
      console.error(err);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
