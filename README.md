# Notopress

> [!CAUTION]
> This project is currently under active development. Expect breaking changes and potential backward incompatibility as we evolve.

Notopress is a modern tool for building markdown-based, content-driven websites. Whether you're creating technical documentation, a personal blog, or high-performance marketing pages, Notopress provides a streamlined workflow to turn your markdown files into a polished web presence.

## Features & Scenarios

Notopress is designed to be flexible and fit into your existing writing workflow:

- **Obsidian Integration**: Manage your entire site directly from your Obsidian vault.
- **Manual Control**: Simply write and organize your markdown files manually in your preferred editor.
- **AI-Assisted Publishing**: Grant AI agents access to your content vaults to generate or refine articles with ease.

## Requirements

To get started with Notopress, you will need:

- **Node.js Runtime**: A modern Node.js environment to host and run the application.
- **S3-Compatible Storage**: Any S3-compatible service (like AWS S3, R2, or MinIO) to store and serve your content assets.

## Usage

### Syncing Content

Notopress includes a sync script to deploy your local markdown content to your S3-compatible storage.

To start the sync process:

```bash
npm run sync
```

#### Dry Run

You can perform a dry run to see what changes would be made without actually modifying any local or remote files:

```bash
npm run sync -- --dry-run
```

This will:
- Preview the `index.json` generation for each locale.
- Show which files would be uploaded, updated, or deleted on the remote storage using the AWS CLI's `--dryrun` mode.

## Roadmap

We are constantly working to improve Notopress. Here is what's on our immediate horizon:

- [ ] **Localization**: Support for multi-language sites and easy translation workflows.
- [ ] **Multi-site Support**: Manage multiple distinct websites from a single Notopress instance.
- [ ] **Responsive Images**: Automatic image optimization and responsive sizing for faster page loads.
- [ ] **Customizable Themes**: Flexible theming system to make your site look exactly how you want.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
