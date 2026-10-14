import { describe, expect, it, vi } from 'vitest';
import { prepareStorageArtifacts } from './storage-artifacts';
import type { VaultStorageFiles } from './vault-inventory';
import { createBuildArtifact } from '../../core/content/build-artifact';
import { passthroughStageTimer } from '../../core/stage-timing';

describe('shared native storage artifacts', () => {
  it('uses prepared outputs, keeps credentials out of registry bytes, and validates sources without writing', async () => {
    const source = createBuildArtifact({ path: 'article.md', content: 'body' });
    const files: VaultStorageFiles = {
      listDirectory: async () => [{ path: source.path, kind: 'file' }],
      hashFile: async () => ({ size: source.size, contentHash: source.contentHash }),
      readFile: source.read, writeFile: vi.fn(async () => undefined),
    };
    const site = { siteId: 'example-site', vaultPath: 'vault', bucketName: 'example-bucket', domain: 'example.invalid' };
    const input = { site, registry: { sites: [site, { ...site, siteId: 'other-site', bucketName: 'other-bucket' }], accessKeyId: 'example-key', secretAccessKey: 'example-secret' }, generatedArtifacts: [createBuildArtifact({ path: 'root.json', content: '{}' })], sourceArtifacts: [source], stageTimer: passthroughStageTimer };
    const prepared = await prepareStorageArtifacts({ input, files });
    const registry = prepared.artifacts.find((entry) => entry.key === 'registry.json');
    expect(JSON.parse(Buffer.from(await registry?.read() || []).toString())).toEqual({ sites: [{ domain: site.domain, siteId: site.siteId }] });
    expect(prepared.artifacts.map((entry) => entry.key)).toContain('example-site/root.json');
    expect(files.writeFile).not.toHaveBeenCalled();
    await expect(prepareStorageArtifacts({ input: { ...input, sourceArtifacts: [{ ...source, contentHash: 'changed' }] }, files })).rejects.toThrow('Build source changed');
  });
});

describe('bounded distribution inventory', () => {
  it('hashes required files directly without walking the vault or distributing sources and local state', async () => {
    const source = createBuildArtifact({ path: 'content/article.md', content: 'Source' });
    const used = createBuildArtifact({ path: 'content/diagram.svg', content: 'SVG' });
    const generated = { ...createBuildArtifact({ path: '_rendered/content/article.html', content: '<img>' }), distribution: { sourceSlug: 'article', noteSlugs: ['article'], assets: [used.path] } };
    const entries = new Map([source, used].map((artifact) => [artifact.path, artifact]));
    const files = { listDirectory: vi.fn(async () => { throw new Error('Vault walking forbidden'); }),
      hashFile: vi.fn(async (file: string) => { const artifact = entries.get(file); if (!artifact) throw new Error('Missing'); return { size: artifact.size, contentHash: artifact.contentHash }; }),
      readFile: async (file: string) => { const artifact = entries.get(file); if (!artifact) throw new Error('Missing'); return artifact.read(); },
      writeFile: vi.fn(async () => undefined),
    };
    const site = { siteId: 'example-site', vaultPath: 'vault', bucketName: 'example-bucket' };
    const prepared = await prepareStorageArtifacts({ input: { site, registry: { sites: [site] }, sourceArtifacts: [source],
      generatedArtifacts: [generated, createBuildArtifact({ path: 'root.json', content: '{}' }), createBuildArtifact({ path: 'AGENTS.md', content: 'Instructions' })],
      scope: { kind: 'incremental', targetSlugs: ['article'] }, stageTimer: passthroughStageTimer,
    }, files });
    expect(prepared.artifacts.map((artifact) => artifact.path)).toEqual(['_rendered/content/article.html', 'content/diagram.svg', 'root.json', 'registry.json']);
    expect(files.listDirectory).not.toHaveBeenCalled();
    expect(files.writeFile).not.toHaveBeenCalled();
    entries.set(source.path, createBuildArtifact({ path: source.path, content: 'EDITED' }));
    await expect(prepared.verifySources()).rejects.toThrow('Build source changed');
  });
});
