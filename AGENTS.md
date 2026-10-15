<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Verification
- Run `npm run type-check`, `npm run lint` and `npm test -- --run` after code changes; always type-check after any change.
- Test supported behavior beside its owning module. Remove obsolete or redundant assertions without weakening regression coverage.

# Architecture
- Keep entry points as orchestrators and feature logic in focused modules. Reuse shared helpers and constants instead of duplicating behavior.
- Use proper TypeScript types, never `any`. Validate untrusted data with Zod; do not bypass validation with type assertions. Prefer named parameters and inject side-effect dependencies explicitly.
- Dependencies flow toward domain and library code: `src/domain/` imports no other layer; `src/lib/` never imports application or scripts. Script core never imports application, infrastructure, CLI or adapters. Application uses the adapter catalog, not concrete adapters. Avoid circular imports.
- Keep platform behavior behind `ContentPlatformAdapter`: core owns canonical snapshots, selection, plan validation and apply ordering; adapters own target rendering, remote discovery, mutations and namespaced state. Keep WordPress implementation and tests in `scripts/adapters/wordpress/`.
- Build stages and adapters contribute typed operations to one shared plan/apply boundary. Prepare every selected plan before remote mutation; preserve read-only dry runs and reviewed composite fingerprint validation. Do not build separate approximations of live behavior.
- Preserve owner-managed source paths and links. Resolve Markdown links and wikilinks at build time; publishing must not move originals or rewrite source references.

# Vault and publication safety
- Git owns source articles and originals; storage serves distribution artifacts. WordPress sends HTML through its API and uploads required assets; native publication keeps its complete HTML and metadata together. Report storage uploads separately from adapter post changes.
- `publish` must not list the whole bucket or treat Git commits as upload confirmation. Full distribution reconciliation and optional remote deletion belong to explicit `sync`. Do not retry ambiguous remote writes automatically.
- Preview production WordPress updates with `--dry-run` before applying the reviewed plan. Do not add `--force` or remote deletion without authorization.
- During article edits, change only source Markdown and source assets. Treat `root.json`, generated `index.json`, rendered HTML and thumbnails as build artifacts; regenerate only when requested. Leave unexpected generated changes unstaged; revert them only after confirming they were unintended.
- Before registry migrations, keep a backup outside Git, validate input and output schemas, and preserve unrelated settings.

# Privacy
- Never log or hardcode credentials. Keep credential-bearing registry and environment files outside Git.
- Use relative paths in documentation and generic fixtures in tests and examples; never include personal filesystem paths, production identifiers or private content. Use environment variables or placeholders for machine-specific configuration.
