import { describe, expect, it } from 'vitest';
import { parseCliCommand } from './command';

describe('CLI command parser', () => {
  it('requires explicit trust and a reviewed live baseline, with pending uploads scoped to storage init', () => {
    expect(parseCliCommand({ argv: ['storage', 'init', '--site', 'example-site', '--trust-local', '--pending', 'pending.json', '--dry-run'] })).toMatchObject({ kind: 'initialize-storage-state', trustLocal: true, pendingFile: 'pending.json', dryRun: true });
    expect(parseCliCommand({ argv: ['storage', 'init', '--trust-local', '--expect', 'a'.repeat(64)] })).toMatchObject({ kind: 'initialize-storage-state', expectedPlanFingerprint: 'a'.repeat(64) });
    expect(() => parseCliCommand({ argv: ['storage', 'init', '--dry-run'] })).toThrow('--trust-local');
    expect(() => parseCliCommand({ argv: ['storage', 'init', '--trust-local'] })).toThrow('reviewed --expect');
    expect(() => parseCliCommand({ argv: ['storage', 'init', '--trust-local', '--dry-run', '--delete'] })).toThrow('not valid');
    expect(() => parseCliCommand({ argv: ['sync', '--trust-local'] })).toThrow('not valid');
    expect(() => parseCliCommand({ argv: ['publish', 'example-main', '--pending', 'pending.json'] })).toThrow('not valid');
  });
  it('supports reviewed storage plans and explicit reconciliation on native commands', () => {
    expect(parseCliCommand({ argv: ['sync', '--site', 'example-site', '--expect', 'a'.repeat(64), '--reconcile-storage'] })).toMatchObject({
      kind: 'sync', expectedPlanFingerprint: 'a'.repeat(64), reconcileStorage: true,
    });
    expect(parseCliCommand({ argv: ['publish', 'example-main', '--dry-run', '--reconcile-storage', '--recover-storage'] })).toMatchObject({
      kind: 'publish', reconcileStorage: true, recoverStorage: true, dryRun: true,
    });
    expect(() => parseCliCommand({ argv: ['sync', '--recover-storage'] })).toThrow('requires --reconcile-storage');
    expect(() => parseCliCommand({ argv: ['sync', '--reconcile-storage', '--recover-storage'] })).toThrow('reviewed --expect');
    expect(() => parseCliCommand({ argv: ['import', 'example-main', 'article', '--reconcile-storage'] })).toThrow('not valid');
  });
  it('uses an optional positional site for native sync commands', () => {
    expect(parseCliCommand({ argv: ['sync', 'example-blog', '--dry-run', '--verbose'] })).toEqual({
      kind: 'sync',
      siteId: 'example-blog',
      registryPath: undefined,
      dryRun: true,
      verbose: true,
      deleteRemoteFiles: false,
    });
  });

  it('parses publisher and source slugs as publish operands', () => {
    expect(parseCliCommand({
      argv: [
        'publish',
        'wordpress-main',
        'health/first',
        'health/second',
        '--site', 'example-blog',
        '--expect', 'a'.repeat(64),
        '--force',
      ],
    })).toEqual({
      kind: 'publish',
      siteId: 'example-blog',
      registryPath: undefined,
      dryRun: false,
      verbose: false,
      publisherId: 'wordpress-main',
      targetSlugs: ['health/first', 'health/second'],
      expectedPlanFingerprint: 'a'.repeat(64),
      force: true,
      deleteRemoteFiles: false,
    });
  });

  it('models import and publisher initialization as subcommands', () => {
    expect(parseCliCommand({
      argv: ['import', 'wordpress-main', 'example-post', '--dry-run'],
    })).toMatchObject({
      kind: 'import',
      publisherId: 'wordpress-main',
      resource: 'example-post',
      dryRun: true,
    });
    expect(parseCliCommand({
      argv: ['publisher', 'init', 'wordpress-main', '--site', 'example-blog'],
    })).toMatchObject({
      kind: 'initialize-platform-state',
      publisherId: 'wordpress-main',
      siteId: 'example-blog',
    });
  });

  it('supports top-level and command help without loading configuration', () => {
    expect(parseCliCommand({ argv: [] })).toEqual({ kind: 'help', topic: undefined });
    expect(parseCliCommand({ argv: ['publish', '--help'] })).toEqual({ kind: 'help', topic: 'publish' });
    expect(parseCliCommand({ argv: ['--version'] })).toEqual({ kind: 'version' });
  });

  it('rejects removed option-driven actions and malformed operands', () => {
    expect(() => parseCliCommand({ argv: ['sync', '--wp'] })).toThrow('Unknown option "--wp"');
    expect(() => parseCliCommand({ argv: ['publish', '--site', 'example-blog'] })).toThrow(
      'Usage: notopress publish <publisher> [slug...]'
    );
    expect(() => parseCliCommand({ argv: ['import', 'wordpress-main'] })).toThrow(
      'Usage: notopress import <publisher> <resource>'
    );
  });
});
