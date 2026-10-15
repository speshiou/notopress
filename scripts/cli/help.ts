const COMMAND_HELP: Record<string, string> = {
  sync: `Usage: notopress sync [site] [options]

Build and synchronize the full native-site distribution. Sources stay in Git.
Configured publishing adapters are not applied.
To publish through an adapter, use "notopress publish <publisher> --site <id>".

Options:
  --dry-run          Preview generated and remote changes
  --delete           Remove missing native files (blocked with adapter-owned assets)
  --expect <hash>    Require the reviewed composite plan fingerprint
  --verbose, -v      Show per-file diagnostics
  --site, -s <id>    Select a site instead of using [site]
  --registry, -r     Use another registry file`,
  deploy: `Usage: notopress deploy [site] [options]

Synchronize the native site, then deploy the Next.js runtime to Vercel.

Options:
  --dry-run          Preview synchronization without deploying
  --delete           Remove missing native files (blocked with adapter-owned assets)
  --expect <hash>    Require the reviewed composite plan fingerprint
  --verbose, -v      Show per-file diagnostics
  --site, -s <id>    Select a site instead of using [site]
  --registry, -r     Use another registry file`,
  publish: `Usage: notopress publish <publisher> [slug...] [options]

Publish through one configured adapter using its build and distribution policy.
Slugs are full vault slugs. Omit them for a site-wide push of changed documents.
WordPress sends HTML through its API and uploads only required assets.
Adapters without overrides distribute complete native HTML and metadata together.
Use sync explicitly for full native distribution reconciliation.

Options:
  --site, -s <id>    Select a site
  --dry-run          Prepare and print the complete publication plan
  --expect <hash>    Require the reviewed composite plan fingerprint
  --force            Publish even when the adapter payload is unchanged
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
  sources: `Usage: notopress sources init [options]

Initialize a local source Git repository and ignore generated distribution files.
Preserve articles, original assets and existing ignore rules. No commits or pushes.
Already tracked generated files remain tracked; review git status and untrack them explicitly if needed.

Options:
  --site, -s <id>    Select a site
  --dry-run          Preview Git initialization without changing the vault
  --expect <hash>    Require the reviewed source setup fingerprint
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
  sources init                       Initialize source Git and ignore generated files

Vault commands refresh the NotoPress block in local AGENTS.md and notify on changes.
Dry runs preview instruction updates without writing; instructions stay out of storage.

Run "notopress help <command>" for command details.`;

export function formatCliHelp({ topic }: { topic?: string }): string {
  if (!topic) return ROOT_HELP;
  const help = COMMAND_HELP[topic];
  if (!help) throw new Error(`Unknown help topic "${topic}".`);
  return help;
}
