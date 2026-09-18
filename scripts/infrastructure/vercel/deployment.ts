import { readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import type { Registry, Site } from '../../../src/domain/registry';
import { env, ENV_KEYS, ENV_METADATA } from '../../../src/lib/env';
import { createVercelEnvironmentSynchronizer } from '../../lib/vercel-environment';
import { runProcess } from '../process';

const VERCEL_CONFIG_PATH = 'vercel.json';

function getProjectId(site: Site): string {
  return site.vercelProjectId || site.siteId;
}

function getEnvironment({ site, registry }: { site: Site; registry: Registry }): Record<string, string | undefined> {
  return {
    [ENV_KEYS.S3_ACCESS_KEY_ID]: registry.accessKeyId,
    [ENV_KEYS.S3_SECRET_ACCESS_KEY]: registry.secretAccessKey,
    [ENV_KEYS.S3_ENDPOINT]: site.endpoint || registry.endpoint || env.S3_ENDPOINT,
    [ENV_KEYS.S3_BUCKET]: site.bucketName,
    [ENV_KEYS.VAULT_ROOT]: site.siteId,
  };
}

function commandEnvironment(site: Site): NodeJS.ProcessEnv {
  return { ...process.env, VERCEL_PROJECT_ID: getProjectId(site) };
}

export async function configureLocalEnvironment({ site, registry }: { site: Site; registry: Registry }): Promise<void> {
  let current = '';
  try {
    current = await readFile('.env.local', 'utf-8');
  } catch {
    // The local environment file is optional.
  }
  const existing: Record<string, string> = {};
  for (const line of current.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...value] = trimmed.split('=');
    existing[key.trim()] = value.join('=').trim();
  }
  const merged = { ...existing, ...getEnvironment({ site, registry }) };
  const content = Object.entries(merged)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  await writeFile('.env.local', content);
  console.log(`✅ Local environment configured for ${site.siteId}.`);
}

async function ensureVercelCli(): Promise<void> {
  try {
    await runProcess({ command: 'vercel', args: ['--version'], options: { stdio: 'ignore' } });
  } catch {
    throw new Error('Vercel CLI is not installed or is not available in PATH.');
  }
}

async function syncEnvironment({ site, registry }: { site: Site; registry: Registry }): Promise<void> {
  const synchronize = createVercelEnvironmentSynchronizer({
    runCommand: ({ args, env: processEnvironment }) => new Promise((resolve) => {
      const child = spawn('vercel', args, {
        shell: false,
        stdio: ['ignore', 'inherit', 'pipe'],
        env: processEnvironment,
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
    variables: getEnvironment({ site, registry }),
    metadata: ENV_METADATA,
    commandEnv: commandEnvironment(site),
  });
}

export async function deployApplication({ site, registry }: { site: Site; registry: Registry }): Promise<void> {
  await ensureVercelCli();
  await syncEnvironment({ site, registry });
  await runProcess({
    command: 'vercel',
    args: ['deploy', '--prod', '--local-config', VERCEL_CONFIG_PATH],
    options: { stdio: 'inherit', env: commandEnvironment(site) },
  });
  console.log('\n✨ Deployment successfully triggered!');
}
