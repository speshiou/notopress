import { select } from '@inquirer/prompts';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { registry } from '../registry';

async function main() {
  const siteId = await select({
    message: 'Select a site to sync using AWS CLI:',
    choices: registry.sites.map(site => ({
      name: `${site.siteId} (${site.domain})`,
      value: site.siteId,
      description: `Vault: ${site.vaultPath} -> Bucket: ${site.bucketName || 'Not configured'}`,
    })),
  });

  const site = registry.sites.find(s => s.siteId === siteId);
  if (!site) {
    console.error('⨯ Site not found in registry.ts');
    process.exit(1);
  }

  if (!site.bucketName) {
    console.error(`⨯ Error: "bucketName" is not configured for site [${site.siteId}] in registry.ts`);
    process.exit(1);
  }

  if (!existsSync(site.vaultPath)) {
    console.error(`⨯ Error: The local vaultPath does not exist: ${site.vaultPath}`);
    process.exit(1);
  }

  console.log(`\n☁️  Preparing AWS S3 Sync to Cloudflare R2...`);
  console.log(`- Local Path: ${site.vaultPath}`);
  console.log(`- R2 Bucket:  ${site.bucketName}`);
  console.log(`- Account ID: ${registry.accountId}\n`);

  try {
    // We add a trailing slash to the vaultPath so that aws s3 sync syncs the *contents* of the directory
    // and not the directory itself.
    const syncCommand = [
      'aws s3 sync',
      `"${site.vaultPath}/"`,
      `"s3://${site.bucketName}/"`,
      `--endpoint-url "https://${registry.accountId}.r2.cloudflarestorage.com"`,
      `--exclude "*.DS_Store"`,
      `--exclude "*/.git/*"`,
      `--exclude ".git/*"`,
      `--delete` // Automatically delete remote files that don't exist locally
    ].join(' ');

    console.log(`Executing:\n> ${syncCommand}\n`);
    
    // stdio: 'inherit' passes the aws-cli output directly to our terminal
    execSync(syncCommand, { 
      stdio: 'inherit',
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: registry.accessKeyId,
        AWS_SECRET_ACCESS_KEY: registry.secretAccessKey
      }
    });
    
    console.log('\n✅ Sync successfully completed!');

  } catch (err: any) {
    console.error('\n⨯ Sync process failed.');
    console.error(err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
