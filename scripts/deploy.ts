import { select } from '@inquirer/prompts';
import { readFile, writeFile, unlink } from 'fs/promises';
import { spawn, SpawnOptions } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getRegistry } from '../src/lib/registry';
import { env, ENV_KEYS, ENV_METADATA } from '../src/lib/env';
import { hasFlag, getFlagValue } from '../src/lib/cli';
import { Registry, Site } from '../src/domain/registry';
import { normalizeThumbnailSizes } from '../src/lib/responsive-images';
import { exists } from './lib/files';
import { generateIndices } from './lib/indices';
import { generateSitemaps } from './lib/sitemaps';

type CommandResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
  stderr: Buffer;
};

type SpawnWithInputOptions = SpawnOptions & {
  input?: string;
};

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

function spawnWithInput({
  command,
  args,
  options = {},
}: {
  command: string;
  args: string[];
  options?: SpawnWithInputOptions;
}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const { input, ...spawnOptions } = options;
    const child = spawn(command, args, { ...spawnOptions, shell: false });
    let stderr = Buffer.alloc(0);

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        stderr = Buffer.concat([stderr, data]);
      });
    }

    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }

    child.on('close', (code, signal) => {
      resolve({ status: code, signal, stderr });
    });

    child.on('error', (error) => {
      resolve({ status: null, signal: null, error, stderr });
    });
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

async function syncSite({ site, registry, isDryRun }: { site: Site; registry: Registry; isDryRun: boolean }) {
  const endpoint = getEndpoint({ site, registry });
  const { accessKeyId, secretAccessKey } = getS3Credentials({ registry });

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error(
      '⨯ Error: Missing S3 credentials. Please provide them in registry.json or via environment variables (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).'
    );
    process.exit(1);
  }

  console.log(`\n☁️  Preparing AWS S3 Sync...`);
  console.log(`- Local Path: ${site.vaultPath}`);
  console.log(`- S3 Bucket:  ${site.bucketName}`);
  console.log(`- Endpoint:   ${endpoint}\n`);

  // We add a trailing slash to the vaultPath so that aws s3 sync syncs the *contents* of the directory
  // and not the directory itself.
  // Each site is synced to its own subdirectory in the bucket: /{site-id}/*
  const args = [
    's3',
    'sync',
    `${site.vaultPath}/`,
    `s3://${site.bucketName}/${site.siteId}/`,
    '--endpoint-url',
    endpoint,
    '--exclude',
    '*.DS_Store',
    '--exclude',
    '*/.git/*',
    '--exclude',
    '.git/*',
    '--delete',
  ];

  if (isDryRun) {
    args.push('--dryrun');
  }

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

    const args = ['s3', 'cp', registryTmpPath, `s3://${site.bucketName}/registry.json`, '--endpoint-url', endpoint];

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

  for (const [key, value] of Object.entries(envVars)) {
    if (!value) {
      console.warn(`⚠️  Warning: ${key} is missing, skipping.`);
      continue;
    }

    const metadataKey = key as keyof typeof ENV_METADATA;
    const metadata = ENV_METADATA[metadataKey];
    if (!metadata) {
      throw new Error(`Missing metadata for environment variable: ${key}`);
    }

    const sensitiveFlag = metadata.isSensitive ? ['--sensitive'] : [];
    console.log(`  Syncing ${key}... (Sensitive: ${metadata.isSensitive})`);

    const addResult = await spawnWithInput({
      command: 'vercel',
      args: ['env', 'add', key, 'production', ...sensitiveFlag],
      options: {
        input: value,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: getVercelCommandEnv({ projectId: vercelProjectId }),
      },
    });

    if (addResult.status !== 0) {
      const stderr = addResult.stderr.toString();

      if (stderr.toLowerCase().includes('already exists')) {
        const updateResult = await spawnWithInput({
          command: 'vercel',
          args: ['env', 'update', key, 'production', ...sensitiveFlag],
          options: {
            input: value,
            stdio: ['pipe', 'inherit', 'inherit'],
            env: getVercelCommandEnv({ projectId: vercelProjectId }),
          },
        });

        if (updateResult.error) throw updateResult.error;
        if (updateResult.status !== 0) {
          throw new Error(`Update failed with status ${updateResult.status}`);
        }
      } else {
        process.stderr.write(addResult.stderr);
        throw addResult.error || new Error(`Command failed with status ${addResult.status}`);
      }
    }

    console.log(`✅ ${key} synchronized${metadata.isSensitive ? ' (as sensitive)' : ''}.`);
  }
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
}: {
  site: Site;
  registry: Registry;
  isDryRun: boolean;
}) {
  const thumbnailSizes = normalizeThumbnailSizes(site.thumbnailSizes || registry.thumbnailSizes);
  const { rootContentIndex, allIndices } = await generateIndices({
    vaultPath: site.vaultPath,
    thumbnailSizes,
    dryRun: isDryRun,
  });

  await generateSitemaps({
    vaultPath: site.vaultPath,
    domain: site.domain,
    rootContentIndex,
    allIndices,
    dryRun: isDryRun,
  });

  await syncSite({ site, registry, isDryRun });

  if (!isDryRun) {
    await uploadRegistry({ site, registry });
  }
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

    await syncContent({ site, registry, isDryRun });
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
