const COMMAND_HELP: Record<string, string> = {
  sync: `Usage: notopress sync [site] [options]

Build and synchronize the native NotoPress site.
Configured publishing adapters are not applied.
To publish through an adapter, use "notopress publish <publisher> --site <id>".

Options:
  --dry-run          Preview generated and remote changes
  --delete           Remove remote files missing from expected outputs
  --expect <hash>    Require the reviewed composite plan fingerprint
  --reconcile-storage  Compare actual remote bytes instead of trusting the manifest
  --recover-storage    Recover interrupted storage after stopping previous publishers
  --verbose, -v      Show per-file diagnostics
  --site, -s <id>    Select a site instead of using [site]
  --registry, -r     Use another registry file`,
  deploy: `Usage: notopress deploy [site] [options]

Synchronize the native site, then deploy the Next.js runtime to Vercel.

Options:
  --dry-run          Preview synchronization without deploying
  --delete           Remove remote files missing from expected outputs
  --expect <hash>    Require the reviewed composite plan fingerprint
  --reconcile-storage  Compare actual remote bytes instead of trusting the manifest
  --recover-storage    Recover interrupted storage after stopping previous publishers
  --verbose, -v      Show per-file diagnostics
  --site, -s <id>    Select a site instead of using [site]
  --registry, -r     Use another registry file`,
  publish: `Usage: notopress publish <publisher> [slug...] [options]

Synchronize the native site and publish through one configured adapter.
Slugs are full vault slugs. Omit them for a site-wide push of changed documents.
Slugs restrict adapter posts only; S3/R2 backup/sync covers the full eligible vault.

Options:
  --site, -s <id>    Select a site
  --dry-run          Prepare and print the complete publication plan
  --expect <hash>    Require the reviewed composite plan fingerprint
  --force            Publish even when the adapter payload is unchanged
  --delete           Remove missing native-site objects during sync
  --reconcile-storage  Compare actual remote bytes instead of trusting the manifest
  --recover-storage    Recover interrupted storage after stopping previous publishers
  --verbose, -v      Show per-file diagnostics
  --registry, -r     Use another registry file`,
  import: `Usage: notopress import <publisher> <resource> [options]

Import one remote resource through an adapter that supports imports.

Options:
  --site, -s <id>    Select a site
  --dry-run          Preview the local write
  --verbose, -v      Show diagnostics
  --registry, -r     Use another registry file`,
  publisher: `Usage: notopress publisher init <publisher> [options]

Mark the adapter's current rendered payloads as synced without publishing.
This trusts local output as the remote baseline and performs no remote verification.

Options:
  --site, -s <id>    Select a site
  --dry-run          Preview the local synced baseline
  --verbose, -v      Show diagnostics
  --registry, -r     Use another registry file`,
  configure: `Usage: notopress configure [site] [options]

Write the selected site's runtime configuration to .env.local.

Options:
  --site, -s <id>    Select a site instead of using [site]
  --registry, -r     Use another registry file`,
};

const ROOT_HELP = `Usage: notopress <command> [options]

Build and publish Markdown vaults.

Commands:
  sync [site]                         Synchronize the native site
  deploy [site]                       Synchronize and deploy to Vercel
  publish <publisher> [slug...]       Publish through an adapter
  import <publisher> <resource>       Import one remote resource
  publisher init <publisher>          Mark current adapter payloads as synced
  configure [site]                    Configure local development

Run "notopress help <command>" for command details.`;

export function formatCliHelp({ topic }: { topic?: string }): string {
  if (!topic) return ROOT_HELP;
  const help = COMMAND_HELP[topic];
  if (!help) throw new Error(`Unknown help topic "${topic}".`);
  return help;
}
