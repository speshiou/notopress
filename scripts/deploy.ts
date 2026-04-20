import { select } from '@inquirer/prompts';
import { execSync, spawnSync } from 'child_process';
import { getRegistry } from '../src/lib/registry';

async function main() {
  // Check if vercel CLI is installed
  try {
    execSync('vercel --version', { stdio: 'ignore' });
  } catch {
    console.error('⨯ Error: Vercel CLI is not installed or not in PATH.');
    console.error('  Please install it with: npm install -g vercel');
    process.exit(1);
  }

  const registry = getRegistry();

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

  const endpoint = site.endpoint || (registry.accountId ? `https://${registry.accountId}.r2.cloudflarestorage.com` : undefined);

  if (!endpoint) {
    console.error(`⨯ Error: No S3 endpoint found. Please provide "endpoint" in site config or "accountId" for Cloudflare R2.`);
    process.exit(1);
  }

  console.log(`\n🚀 Preparing deployment for ${site.domain}...`);
  console.log(`- Site ID: ${site.siteId}`);
  console.log(`- Vercel Project ID: ${vercelProjectId}${site.vercelProjectId ? '' : ' (fallback to siteId)'}`);

  const envVars = {
    S3_ACCESS_KEY_ID: registry.accessKeyId,
    S3_SECRET_ACCESS_KEY: registry.secretAccessKey,
    S3_ENDPOINT: endpoint,
    S3_BUCKET: site.bucketName,
  };

  console.log(`\n📡 Synchronizing environment variables to Vercel...`);

  for (const [key, value] of Object.entries(envVars)) {
    if (!value) {
      console.warn(`⚠️  Warning: ${key} is missing, skipping.`);
      continue;
    }

    try {
      // Step 1: Try to add the environment variable
      const addResult = spawnSync('vercel', ['env', 'add', key, 'production'], {
        input: value,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, VERCEL_PROJECT_ID: vercelProjectId }
      });

      if (addResult.status !== 0) {
        const stderr = addResult.stderr.toString();
        
        // If it already exists, we use 'update' instead to avoid downtime
        if (stderr.toLowerCase().includes('already exists')) {
          const updateResult = spawnSync('vercel', ['env', 'update', key, 'production'], {
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

      console.log(`✅ ${key} synchronized.`);
    } catch (err: any) {
      console.error(`⨯ Failed to sync ${key}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\n📦 Triggering production deployment...`);
  try {
    execSync('vercel deploy --prod', {
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
