import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import * as markdownRenderer from '../../../src/lib/markdown';
import { computeContentHash } from '../../core/state/sync-state';
import { getWordPressAssetScope, getWordPressAssetKey } from './import-assets';
import { getWordPressPublicationStateFromObject } from './publication-state';
import { runCommand } from '../../application/run-command';
import { passthroughStageTimer } from '../../core/stage-timing';
import type { AwsCliRequest } from '../../infrastructure/native/aws-cli';

const harness = vi.hoisted(() => ({ runCli: vi.fn<(input: AwsCliRequest) => Promise<string>>() }));
vi.mock('../../infrastructure/native/storage', async (original) => {
  const actual = await original<typeof import('../../infrastructure/native/storage')>();
  return { ...actual, prepareNativeSite: actual.createNativeSitePreparation({ runCli: harness.runCli,
    resolveConnection: () => ({ target: { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' }, credentials: { accessKeyId: 'example-key', secretAccessKey: 'example-secret' } }),
    environment: { NODE_ENV: 'test' },
  }) };
});

async function filesUnder(directory: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  async function walk(relative: string) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(file);
      else result.set(file, await readFile(path.join(directory, file)));
    }
  }
  await walk('');
  return result;
}

const PostPayloadSchema = z.object({ content: z.string() });

describe('WordPress overrides with shared plan/apply infrastructure', () => {
  it('previews read-only, rejects stale plans, uploads only declared assets, and sends HTML through the API', async () => {
    const vaultPath = await mkdtemp(path.join(tmpdir(), 'notopress-wordpress-distribution-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const uploaded = new Map<string, Buffer>();
    const apiPayloads: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === 'POST') {
        const payload = PostPayloadSchema.parse(JSON.parse(String(init.body)));
        apiPayloads.push(payload.content);
        return new Response(JSON.stringify({ id: 123, slug: 'article' }));
      }
      return new Response('[]');
    });
    vi.stubGlobal('fetch', fetchMock);
    harness.runCli.mockImplementation(async ({ args }) => {
      expect(args.slice(0, 2)).toEqual(['s3', 'cp']);
      expect(args).toContain('--recursive');
      const files = await filesUnder(args[2]);
      if (!args.includes('--dryrun')) for (const [file, bytes] of files) uploaded.set(file, bytes);
      return [...files.keys()].map((file) => `(dryrun) upload: ${path.join(args[2], file)} to ${args[3]}${file}`).join('\n');
    });
    try {
      await mkdir(path.join(vaultPath, 'content'));
      await mkdir(path.join(vaultPath, '_includes'));
      const source = (title: string, body: string) => `---\ntitle: ${title}\ndate: 2026-01-01\nupdated: 2026-01-01\n---\n# ${title}\n\n${body}\n`;
      await writeFile(path.join(vaultPath, 'AGENTS.md'), '# Owner instructions\n');
      await writeFile(path.join(vaultPath, 'content/article.md'), source('Article', '![Diagram](/legacy/%E6%B8%AC%E8%A9%A6.svg)\n\n![[example-note]]\n\n<!-- wp:example/visual {"imageUrl":"https://assets.example.com/example-site/content/hero.svg"} /-->'));
      await writeFile(path.join(vaultPath, 'content/unrelated-new.md'), source('Unrelated', '![Missing](missing.svg)'));
      await writeFile(path.join(vaultPath, '_includes/example-note.md'), '# Example note\n\nIncluded body.');
      await writeFile(path.join(vaultPath, 'content/diagram.svg'), '<svg>Diagram</svg>');
      await writeFile(path.join(vaultPath, 'content/hero.svg'), '<svg>Hero</svg>');
      const originalUrl = 'https://assets.example.com/example-site/content/legacy/%25E6%25B8%25AC%25E8%25A9%25A6.svg';
      const scope = getWordPressAssetScope({ endpoint: 'https://wordpress.example.com/wp-json', hash: computeContentHash });
      await writeFile(path.join(vaultPath, '.notopress-sync.json'), JSON.stringify({ wordpressAssets: {
        [getWordPressAssetKey({ scope, source: originalUrl })]: { root: 'content', path: 'diagram.svg', originalUrl, contentHash: computeContentHash('<svg>Diagram</svg>') },
      } }));
      const before = await filesUnder(vaultPath);
      const site = { siteId: 'example-site', vaultPath, bucketName: 'example-bucket', noteIncludePaths: ['_includes'], imageHost: 'https://assets.example.com',
        publishers: [{ id: 'wordpress-main', type: 'wordpress', config: { endpoint: 'https://wordpress.example.com/wp-json', username: 'editor', applicationPassword: 'example-password' } }],
      };
      const command = { kind: 'publish', publisherId: 'wordpress-main', targetSlugs: ['article'], siteId: site.siteId, dryRun: true, verbose: false, force: false, deleteRemoteFiles: false } as const;
      const run = (dryRun: boolean, expectedPlanFingerprint?: string) => runCommand({ command: { ...command, dryRun, expectedPlanFingerprint }, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      await run(true);
      expect(await filesUnder(vaultPath)).toEqual(before);
      expect(apiPayloads).toEqual([]);
      expect(uploaded.size).toBe(0);
      const fingerprint = log.mock.calls.map(([message]) => String(message)).findLast((line) => line.includes('NotoPress publication plan '))?.match(/NotoPress publication plan ([a-f0-9]{64}):/)?.[1];
      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
      await writeFile(path.join(vaultPath, 'content/hero.svg'), '<svg>Changed hero</svg>');
      await expect(run(false, fingerprint)).rejects.toThrow('plan changed');
      expect(uploaded.size).toBe(0);
      expect(apiPayloads).toEqual([]);
      expect(await readFile(path.join(vaultPath, 'AGENTS.md'), 'utf8')).toBe('# Owner instructions\n');
      await writeFile(path.join(vaultPath, 'content/hero.svg'), '<svg>Hero</svg>');
      await run(false, fingerprint);
      expect([...uploaded.keys()].sort()).toEqual(['content/diagram.svg', 'content/hero.svg']);
      expect(apiPayloads).toHaveLength(1);
      expect(apiPayloads[0]).toContain('Included body.');
      expect(apiPayloads[0]).toContain('/content/diagram.svg');
      expect(apiPayloads[0]).not.toContain('/legacy/');
      expect(apiPayloads[0]).toContain('wp:example/visual');
      const after = await filesUnder(vaultPath);
      for (const [file, bytes] of before) if (file !== 'AGENTS.md' && file !== '.notopress-sync.json') expect(after.get(file)).toEqual(bytes);
      expect([...after.keys()].some((file) => file.startsWith('_rendered/') || file === 'root.json' || file.startsWith('public/'))).toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('only adapter-declared assets; no native HTML, indexes or sitemaps'));
      expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('unrelated-new'))).toBe(true);
      // Existing caches learn asset dependencies once without rewriting unchanged API content.
      await rm(path.join(vaultPath, 'content/unrelated-new.md'));
      const state = z.record(z.string(), z.record(z.string(), z.unknown())).parse(JSON.parse(await readFile(path.join(vaultPath, '.notopress-sync.json'), 'utf8')));
      const entries = getWordPressPublicationStateFromObject(state);
      delete entries.article.distributionAssets;
      state.wordpress = entries;
      await writeFile(path.join(vaultPath, '.notopress-sync.json'), JSON.stringify(state));
      const render = vi.spyOn(markdownRenderer, 'renderMarkdownContent');
      const requestsBefore = fetchMock.mock.calls.length;
      await runCommand({ command: { ...command, targetSlugs: undefined, dryRun: false }, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      expect(render).toHaveBeenCalledOnce();
      expect(apiPayloads).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(requestsBefore);
      render.mockClear();
      await runCommand({ command: { ...command, targetSlugs: undefined, dryRun: false }, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      expect(render).not.toHaveBeenCalled();
      expect(apiPayloads).toHaveLength(1);
      expect([...uploaded.keys()].sort()).toEqual(['content/diagram.svg', 'content/hero.svg']);
      uploaded.clear();
      harness.runCli.mockClear();
      const warmBefore = await filesUnder(vaultPath);
      await runCommand({ command: { ...command, targetSlugs: undefined, dryRun: true }, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      expect(uploaded.size).toBe(0);
      expect(harness.runCli).not.toHaveBeenCalled();
      expect(await filesUnder(vaultPath)).toEqual(warmBefore);
      await runCommand({ command: { ...command, targetSlugs: undefined, dryRun: false }, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      expect(harness.runCli).not.toHaveBeenCalled();
      // Block-only image changes must upload even when Markdown and the API HTML stay unchanged.
      await writeFile(path.join(vaultPath, 'content/hero.svg'), '<svg>Replacement hero</svg>');
      await runCommand({ command: { ...command, targetSlugs: undefined, dryRun: true }, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      const changedFingerprint = log.mock.calls.map(([message]) => String(message)).findLast((line) => line.includes('NotoPress publication plan '))?.match(/NotoPress publication plan ([a-f0-9]{64}):/)?.[1];
      await writeFile(path.join(vaultPath, 'content/hero.svg'), '<svg>Another replacement</svg>');
      await expect(runCommand({ command: { ...command, targetSlugs: undefined, dryRun: false, expectedPlanFingerprint: changedFingerprint }, registry: { sites: [site] }, stageTimer: passthroughStageTimer })).rejects.toThrow('plan changed');
      expect(uploaded.size).toBe(0);
      await writeFile(path.join(vaultPath, 'content/hero.svg'), '<svg>Replacement hero</svg>');
      await runCommand({ command: { ...command, targetSlugs: undefined, dryRun: false, expectedPlanFingerprint: changedFingerprint }, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      expect([...uploaded.keys()]).toEqual(['content/hero.svg']);
      expect(apiPayloads).toHaveLength(1);
      uploaded.clear();
      harness.runCli.mockClear();
      await writeFile(path.join(vaultPath, 'content/article.md'), `${await readFile(path.join(vaultPath, 'content/article.md'), 'utf8')}\nText update.\n`);
      await run(false);
      expect(apiPayloads).toHaveLength(2);
      expect(harness.runCli).not.toHaveBeenCalled();
      render.mockRestore();
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); log.mockRestore(); await rm(vaultPath, { recursive: true, force: true }); }
  });
});
