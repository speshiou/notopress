import { describe, expect, it } from 'vitest';
import { parseCliCommand } from './command';

describe('CLI command parser', () => {
  it('supports fingerprinted native sync and rejects removed custom storage actions', () => {
    expect(parseCliCommand({ argv: ['sync', '--site', 'example-site', '--expect', 'a'.repeat(64)] })).toMatchObject({ kind: 'sync', expectedPlanFingerprint: 'a'.repeat(64) });
    expect(() => parseCliCommand({ argv: ['storage', 'init', '--trust-local'] })).toThrow('have been removed');
    expect(() => parseCliCommand({ argv: ['sync', '--reconcile-storage'] })).toThrow('Unknown option');
    expect(() => parseCliCommand({ argv: ['sync', '--recover-storage'] })).toThrow('Unknown option');
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

  it('supports reviewed source Git setup and reserves deletion for full sync', () => {
    expect(parseCliCommand({ argv: ['sources', 'init', '--site', 'example-site', '--dry-run', '--expect', 'a'.repeat(64)] })).toMatchObject({ kind: 'initialize-sources', dryRun: true, expectedPlanFingerprint: 'a'.repeat(64) });
    expect(() => parseCliCommand({ argv: ['publish', 'example-main', '--delete'] })).toThrow('--delete is not valid');
    expect(parseCliCommand({ argv: ['sync', '--delete'] })).toMatchObject({ kind: 'sync', deleteRemoteFiles: true });
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
