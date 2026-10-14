import { describe, expect, it, vi } from 'vitest';
import { createNativeSitePreparation } from './storage';
import { createBuildArtifact } from '../../core/content/build-artifact';
import { passthroughStageTimer } from '../../core/stage-timing';
import type { AwsCliRunner } from './aws-cli';

function setup() {
  const source = createBuildArtifact({ path: 'article.md', content: 'body' });
  const writeFile = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const verify = vi.fn(async () => undefined);
  const staged = { snapshotPath: 'snapshot', registryPath: 'registry.json', configPath: 'aws-config', verify, close };
  const runCli = vi.fn<AwsCliRunner>(async () => '(dryrun) upload: snapshot/article.md to s3://example-bucket/example-site/article.md\n');
  const logger = { log: vi.fn() };
  const history = { describe: vi.fn(async () => 'Last successful full vault sync: unknown.'), record: vi.fn(async () => undefined) };
  const prepare = createNativeSitePreparation({
    resolveConnection: () => ({ target: { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' }, credentials: { accessKeyId: 'example-key', secretAccessKey: 'example-secret' } }),
    createFiles: () => ({ listDirectory: async () => [{ path: source.path, kind: 'file' }], hashFile: async (file) => {
      if (file === source.path) return { size: source.size, contentHash: source.contentHash };
      throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
    }, readFile: source.read, writeFile }),
    snapshot: async () => staged, runCli, environment: { NODE_ENV: 'test' }, logger,
    createHistory: () => history,
  });
  const site = { siteId: 'example-site', vaultPath: 'vault', bucketName: 'example-bucket' };
  const input = { site, registry: { sites: [site] }, generatedArtifacts: [createBuildArtifact({ path: 'root.json', content: '{}' })], deleteRemoteFiles: false, verbose: false, stageTimer: passthroughStageTimer };
  return { prepare, input, writeFile, close, verify, runCli, logger, history };
}

describe('AWS CLI storage boundary', () => {
  it('previews read-only, then validates the same plan before generated writes and full CLI sync/registry upload', async () => {
    const h = setup();
    const prepared = await h.prepare(h.input);
    await prepared.apply({ dryRun: true });
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.runCli).toHaveBeenCalledTimes(1);
    expect(h.history.record).not.toHaveBeenCalled();
    expect(h.runCli.mock.calls[0][0]).toEqual(expect.objectContaining({ args: expect.arrayContaining(['--dryrun']), environment: expect.objectContaining({ AWS_MAX_ATTEMPTS: '1', AWS_CONFIG_FILE: 'aws-config' }) }));
    expect(JSON.stringify(h.logger.log.mock.calls)).not.toContain('example-secret');
    await prepared.apply({ dryRun: false });
    expect(h.writeFile).toHaveBeenCalledOnce();
    expect(h.runCli).toHaveBeenCalledTimes(4);
    expect(h.runCli.mock.calls[2][0]).toEqual(expect.objectContaining({ args: expect.arrayContaining(['s3', 'sync', 'snapshot/', 's3://example-bucket/example-site/']) }));
    expect(h.runCli.mock.calls[3][0]).toEqual(expect.objectContaining({ args: expect.arrayContaining(['s3', 'cp', 'registry.json', 's3://example-bucket/registry.json']) }));
    expect(h.history.record).toHaveBeenCalledExactlyOnceWith({ target: { endpoint: 'https://storage.example.com', bucket: 'example-bucket', siteId: 'example-site' } });
    await prepared.close();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it('rejects remote plan drift or tampered snapshot before local or remote writes', async () => {
    const h = setup();
    const prepared = await h.prepare(h.input);
    h.runCli.mockResolvedValueOnce('');
    await expect(prepared.apply({ dryRun: false })).rejects.toThrow('plan changed');
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.history.record).not.toHaveBeenCalled();
    expect(h.runCli.mock.calls.every(([request]) => request.args.includes('--dryrun'))).toBe(true);
    h.verify.mockRejectedValueOnce(new Error('tampered'));
    await expect(prepared.apply({ dryRun: false })).rejects.toThrow('tampered');
    expect(h.runCli).toHaveBeenCalledTimes(2);
    await prepared.close();
  });

  it('cleans preparation failures and never retries a failed live command or proceeds to registry upload', async () => {
    const failed = setup();
    failed.runCli.mockRejectedValueOnce(new Error('failed'));
    await expect(failed.prepare(failed.input)).rejects.toThrow('failed');
    expect(failed.close).toHaveBeenCalledOnce();
    const h = setup();
    const prepared = await h.prepare(h.input);
    h.runCli.mockResolvedValueOnce('(dryrun) upload: snapshot/article.md to s3://example-bucket/example-site/article.md\n').mockRejectedValueOnce(new Error('uncertain'));
    await expect(prepared.apply({ dryRun: false })).rejects.toThrow('uncertain');
    expect(h.runCli).toHaveBeenCalledTimes(3);
    expect(h.history.record).not.toHaveBeenCalled();
    await prepared.close();
  });

  it('records no success when registry upload fails, and treats history-write failures as advisory', async () => {
    const failed = setup();
    const storage = await failed.prepare({ ...failed.input, remindFullSync: true });
    expect(failed.history.describe).toHaveBeenCalledWith(expect.objectContaining({ remind: true }));
    failed.runCli.mockResolvedValueOnce('(dryrun) upload: snapshot/article.md to s3://example-bucket/example-site/article.md\n')
      .mockResolvedValueOnce('').mockRejectedValueOnce(new Error('registry failed'));
    await expect(storage.apply({ dryRun: false })).rejects.toThrow('registry failed');
    expect(failed.history.record).not.toHaveBeenCalled();
    await storage.close();
    const h = setup();
    const prepared = await h.prepare(h.input);
    h.history.record.mockRejectedValueOnce(new Error('disk full'));
    await expect(prepared.apply({ dryRun: false })).resolves.toBeUndefined();
    expect(h.logger.log).toHaveBeenCalledWith(expect.stringContaining('completion time could not be saved'));
    expect(h.runCli).toHaveBeenCalledTimes(4);
    await prepared.close();
  });
});
