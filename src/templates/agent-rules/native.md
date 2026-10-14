# Notopress Commands
- **Sync Distribution**:
  - `npm --prefix {{notopressPath}} run sync -- --site {{siteId}}`: Builds and reconciles the full HTML distribution, including indexes and thumbnails. Source Markdown stays in Git.
  - `npm --prefix {{notopressPath}} run sync -- --site {{siteId}} --delete`: Also removes remote files that no longer exist locally. Remote files are preserved unless this flag is provided.
  - `npm --prefix {{notopressPath}} run sync -- --site {{siteId}} --dry-run`: Previews sync changes without writing files.
  - `npm --prefix {{notopressPath}} run sync -- --site {{siteId}} --verbose`: Shows per-directory and per-file diagnostics. Normal syncs keep warnings and summaries visible without verbose output.
