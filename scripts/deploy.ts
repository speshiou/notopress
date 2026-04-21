import { select } from '@inquirer/prompts';
import { spawn } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import { getRegistry } from '../src/lib/registry';
import { ENV_KEYS, ENV_METADATA } from '../src/lib/env';

function execAsync(command: string, options: any = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { ...options, shell: true });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
}

function spawnAsync(command: string, args: string[], options: any = {}): Promise<{ status: number | null, signal: string | null, error?: Error, stderr: Buffer }> {
  return new Promise((resolve) => {
    const { input, ...spawnOptions } = options;
    const child = spawn(command, args, spawnOptions);
    let stderr = Buffer.alloc(0);

    if (child.stderr) {
      child.stderr.on('data', (data) => {
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

async function main() {
  const isDev = process.argv.includes('--dev');

  // Check if vercel CLI is installed (only if NOT in dev mode)
  if (!isDev) {
    try {
      await execAsync('vercel --version', { stdio: 'ignore' });
    } catch {
      console.error('⨯ Error: Vercel CLI is not installed or not in PATH.');
      console.error('  Please install it with: npm install -g vercel');
      process.exit(1);
    }
  }

  const registry = await getRegistry();

  const siteId = await select({
    message: 'Select a site to deploy to Vercel:',
    choices: registry.sites.map(site => ({
      name: `${site.siteId} (${site.domain})`,
      value: site.siteId,
      description: `Project ID: ${site.vercelProjectId || 'Not configured'}`,
    })),
  });

  const site = registry.sites.find(s => s.siteId === siteId);
  if (!site) {
    console.error('⨯ Site not found in registry.json');
    process.exit(1);
  }

  const vercelProjectId = site.vercelProjectId || site.siteId;

  const endpoint = site.endpoint || registry.endpoint;

  if (!endpoint) {
    console.error(`⨯ Error: No S3 endpoint found. Please provide "endpoint" in site or registry configuration.`);
    process.exit(1);
  }

  console.log(`\n🚀 Preparing deployment for ${site.domain}...`);
  console.log(`- Site ID: ${site.siteId}`);
  console.log(`- Vercel Project ID: ${vercelProjectId}${site.vercelProjectId ? '' : ' (fallback to siteId)'}`);

  const envVars = {
    [ENV_KEYS.S3_ACCESS_KEY_ID]: registry.accessKeyId,
    [ENV_KEYS.S3_SECRET_ACCESS_KEY]: registry.secretAccessKey,
    [ENV_KEYS.S3_ENDPOINT]: endpoint,
    [ENV_KEYS.S3_BUCKET]: site.bucketName,
    [ENV_KEYS.VAULT_ROOT]: site.siteId,
  };

  if (isDev) {
    console.log(`\n🛠️  Running in DEV mode - Updating .env.local for ${site.siteId}...`);

    let envContent = '';
    try {
      envContent = await readFile('.env.local', 'utf-8');
    } catch {
      // .env.local might not exist, that's fine
    }

    const lines = envContent.split('\n');
    const existingVars: Record<string, string> = {};

    // Parse existing variables while preserving comments or structure is hard with a simple split,
    // so we'll just parse keys and re-generate.
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        existingVars[key.trim()] = valueParts.join('=').trim();
      }
    });

    // Merge new values
    const finalVars = { ...existingVars, ...envVars };

    const newContent = Object.entries(finalVars)
      .filter(([_, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    await writeFile('.env.local', newContent);
    console.log('✅ .env.local updated successfully.');
    console.log('\n✨ Local development context switched. Restart npm run dev to see changes.');
    process.exit(0);
  }

  console.log(`\n📡 Synchronizing environment variables to Vercel...`);

  for (const [key, value] of Object.entries(envVars)) {
    if (!value) {
      console.warn(`⚠️  Warning: ${key} is missing, skipping.`);
      continue;
    }

    const metadata = ENV_METADATA[key as keyof typeof ENV_KEYS];
    if (!metadata) {
      throw new Error(`Missing metadata for environment variable: ${key}`);
    }
    const isSensitive = metadata.isSensitive;
    const sensitiveFlag = isSensitive ? ['--sensitive'] : [];

    // Diagnostic logging to help troubleshoot sensitivity issues
    console.log(`  Syncing ${key}... (Sensitive: ${isSensitive})`);

    try {
      // Step 1: Try to add the environment variable
      const addResult = await spawnAsync('vercel', ['env', 'add', key, 'production', ...sensitiveFlag], {
        input: value,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, VERCEL_PROJECT_ID: vercelProjectId }
      });

      if (addResult.status !== 0) {
        const stderr = addResult.stderr.toString();

        // If it already exists, we use 'update' instead to avoid downtime
        if (stderr.toLowerCase().includes('already exists')) {
          const updateResult = await spawnAsync('vercel', ['env', 'update', key, 'production', ...sensitiveFlag], {
            input: value,
            stdio: ['pipe', 'inherit', 'inherit'],
            env: { ...process.env, VERCEL_PROJECT_ID: vercelProjectId }
          });

          if (updateResult.error) throw updateResult.error;
          if (updateResult.status !== 0) {
            throw new Error(`Update failed with status ${updateResult.status}`);
          }
        } else {
          // For any other error, we report it and fail
          process.stderr.write(addResult.stderr);
          throw addResult.error || new Error(`Command failed with status ${addResult.status}`);
        }
      }

      console.log(`✅ ${key} synchronized${isSensitive ? ' (as sensitive)' : ''}.`);
    } catch (err: any) {
      console.error(`⨯ Failed to sync ${key}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n📦 Triggering production deployment...`);
  try {
    await execAsync('vercel deploy --prod', {
      stdio: 'inherit',
      env: { ...process.env, VERCEL_PROJECT_ID: vercelProjectId }
    });
    console.log(`\n✨ Deployment successfully triggered!`);
  } catch (err: any) {
    console.error(`\n⨯ Deployment failed.`);
    console.error(err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
