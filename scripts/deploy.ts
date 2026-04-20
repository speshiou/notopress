import { select } from '@inquirer/prompts';
import { execSync, spawnSync } from 'child_process';
import { getRegistry } from '../src/lib/registry';

async function main() {
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

  if (!site.vercelProjectId) {
    console.error(`⨯ Error: "vercelProjectId" is not configured for site [${site.siteId}] in registry.json`);
    process.exit(1);
  }

  const endpoint = site.endpoint || (registry.accountId ? `https://${registry.accountId}.r2.cloudflarestorage.com` : undefined);

  if (!endpoint) {
    console.error(`⨯ Error: No S3 endpoint found. Please provide "endpoint" in site config or "accountId" for Cloudflare R2.`);
    process.exit(1);
  }

  console.log(`\n🚀 Preparing deployment for ${site.domain}...`);
  console.log(`- Site ID: ${site.siteId}`);
  console.log(`- Vercel Project ID: ${site.vercelProjectId}`);

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
      // We attempt to remove the variable first to ensure it's updated.
      // The -y flag skips the confirmation prompt.
      // We ignore the result of the removal in case it doesn't exist yet.
      spawnSync('vercel', ['env', 'rm', key, 'production', '-y'], {
        stdio: 'ignore',
        env: { ...process.env, VERCEL_PROJECT_ID: site.vercelProjectId }
      });

      // Add the variable to the production environment
      // We use spawnSync to pipe the value into stdin safely
      const addResult = spawnSync('vercel', ['env', 'add', key, 'production'], {
        input: value,
        stdio: ['pipe', 'inherit', 'inherit'],
        env: { ...process.env, VERCEL_PROJECT_ID: site.vercelProjectId }
      });

      if (addResult.status !== 0) {
        throw new Error(`Command failed with status ${addResult.status}`);
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
      env: { ...process.env, VERCEL_PROJECT_ID: site.vercelProjectId }
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
