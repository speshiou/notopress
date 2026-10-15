import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import type { AwsCliRequest } from '../infrastructure/native/aws-cli';
import { passthroughStageTimer } from '../core/stage-timing';
import { runCommand } from './run-command';
import { createOperationPlan } from '../core/publishing/operation-plan';

const harness = vi.hoisted(() => ({ runCli: vi.fn<(request: AwsCliRequest) => Promise<string>>(), apply: vi.fn<(input: { dryRun: boolean }) => Promise<void>>() }));
vi.mock('../infrastructure/native/storage', async (original) => {
  const actual = await original<typeof import('../infrastructure/native/storage')>();
  return { ...actual, prepareNativeSite: actual.createNativeSitePreparation({ runCli: harness.runCli,
    resolveConnection: () => ({ target: { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' }, credentials: { accessKeyId: 'example-key', secretAccessKey: 'example-secret' } }),
    environment: { NODE_ENV: 'test' },
  }) };
});
vi.mock('../adapters/catalog', () => ({
  createConfiguredPlatformAdapters: () => [{ id: 'example-main', type: 'example', preparePublication: async () => ({ id: 'example-main', label: 'Example',
    plan: createOperationPlan({ kind: 'example-publisher', operations: [], serializeOperation: (operation) => operation }), apply: harness.apply,
  }) }],
}));

async function filesUnder(directory: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  async function walk(relative: string) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(file);
      else files.set(file, await readFile(path.join(directory, file)));
    }
  }
  await walk('');
  return files;
}

describe('incremental publication and full distribution reconciliation', () => {
  it('preserves dry runs and portable fingerprints, uploads bounded dependencies, and leaves full coverage to sync', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'notopress-incremental-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const remote = new Map<string, Buffer>();
    harness.apply.mockResolvedValue(undefined);
    harness.runCli.mockImplementation(async ({ args }) => {
      const source = args[2]; const destination = args[3];
      const files = args.includes('--recursive') || args[1] === 'sync'
        ? await filesUnder(source) : new Map([['', await readFile(source)]]);
      const changes: string[] = [];
      for (const [file, bytes] of files) {
        const key = `${destination}${file}`;
        if (args[1] === 'sync' && remote.get(key)?.equals(bytes)) continue;
        if (args.includes('--dryrun')) changes.push(`(dryrun) upload: ${path.join(source, file)} to ${key}`);
        else remote.set(key, bytes);
      }
      return changes.join('\n');
    });
    try {
      const vault = path.join(root, 'vault');
      await mkdir(path.join(vault, 'content'), { recursive: true });
      await mkdir(path.join(vault, 'public'));
      const note = (title: string, body: string) => `---\ntitle: ${title}\ndate: 2026-01-01\nupdated: 2026-01-02\n---\n# ${title}\n\n${body}\n`;
      await writeFile(path.join(vault, 'content/article.md'), note('Example', '![Image](hero.png)'));
      await writeFile(path.join(vault, 'content/dependent.md'), note('Dependent', '![[article]]'));
      await writeFile(path.join(vault, 'content/unrelated.md'), note('Unrelated', '![Other](other.svg)'));
      await writeFile(path.join(vault, 'public/unused.txt'), 'Attachment');
      await writeFile(path.join(vault, 'content/hero.png'), await sharp({ create: { width: 16, height: 16, channels: 3, background: '#808080' } }).png().toBuffer());
      const before = await filesUnder(vault);
      const site = { siteId: 'example-site', vaultPath: vault, bucketName: 'example-bucket', domain: 'example.com', imageHost: 'https://assets.example.com', thumbnailSizes: [8] };
      const command = { kind: 'publish', publisherId: 'example-main', targetSlugs: ['article'], siteId: site.siteId, dryRun: true, verbose: false, force: false, deleteRemoteFiles: false } as const;
      const fingerprint = () => {
        const line = log.mock.calls.map(([line]) => String(line)).findLast((line) => line.includes('NotoPress publication plan '));
        const hash = line?.match(/NotoPress publication plan ([a-f0-9]{64}):/)?.[1];
        if (!hash) throw new Error('Missing reviewed fingerprint');
        return hash;
      };
      await runCommand({ command, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      const reviewed = fingerprint();
      expect(await filesUnder(vault)).toEqual(before);
      expect(remote.size).toBe(0);
      expect(harness.runCli.mock.calls.every(([request]) => request.args[1] === 'cp' && request.args.includes('--dryrun'))).toBe(true);
      const migrated = path.join(root, 'copied-vault');
      await cp(vault, migrated, { recursive: true });
      await runCommand({ command, registry: { sites: [{ ...site, vaultPath: migrated }] }, stageTimer: passthroughStageTimer });
      expect(fingerprint()).toBe(reviewed);
      await writeFile(path.join(vault, 'content/article.md'), note('Example', 'Changed body'));
      harness.apply.mockClear();
      await expect(runCommand({ command: { ...command, dryRun: false, expectedPlanFingerprint: reviewed }, registry: { sites: [site] }, stageTimer: passthroughStageTimer })).rejects.toThrow('plan changed');
      expect(remote.size).toBe(0); expect(harness.apply).not.toHaveBeenCalled();
      expect((await filesUnder(vault)).has('AGENTS.md')).toBe(false);
      await writeFile(path.join(vault, 'content/article.md'), before.get('content/article.md') || '');
      await runCommand({ command: { ...command, dryRun: false, expectedPlanFingerprint: reviewed }, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      expect([...remote.keys()]).toContain('s3://example-bucket/example-site/_rendered/content/article.html');
      expect([...remote.keys()]).toContain('s3://example-bucket/example-site/_rendered/content/dependent.html');
      expect([...remote.keys()].some((key) => key.includes('hero-8.webp'))).toBe(true);
      expect([...remote.keys()].some((key) => key.includes('unrelated.html') || key.includes('other.svg') || key.endsWith('.md') || key.endsWith('hero.png'))).toBe(false);
      const after = await filesUnder(vault);
      expect(after.get('AGENTS.md')?.toString()).toContain('## NotoPress workflow');
      expect([...remote.keys()].some((key) => key.endsWith('AGENTS.md'))).toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Read the updated block before continuing'));
      for (const [file, content] of before) expect(after.get(file)).toEqual(content);
      expect(after.has('.notopress/full-sync.json')).toBe(false);
      expect(harness.apply).toHaveBeenCalledWith({ dryRun: false });
      // A missing asset in an unrelated article must not block targeted publication.
      await writeFile(path.join(vault, 'content/other.svg'), '<svg></svg>');
      const sync = { kind: 'sync', siteId: site.siteId, dryRun: true, verbose: false, deleteRemoteFiles: false } as const;
      await runCommand({ command: sync, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      const fullReviewed = fingerprint();
      await runCommand({ command: { ...sync, dryRun: false, expectedPlanFingerprint: fullReviewed }, registry: { sites: [site] }, stageTimer: passthroughStageTimer });
      expect([...remote.keys()]).toContain('s3://example-bucket/example-site/_rendered/content/unrelated.html');
      expect([...remote.keys()]).toContain('s3://example-bucket/example-site/content/other.svg');
      expect([...remote.keys()]).toContain('s3://example-bucket/example-site/public/unused.txt');
      expect([...remote.keys()].some((key) => key.endsWith('.md'))).toBe(false);
      expect((await filesUnder(vault)).has('.notopress/full-sync.json')).toBe(true);
    } finally {
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  });
});
