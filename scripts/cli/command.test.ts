import { describe, expect, it } from 'vitest';
import { parseCliCommand } from './command';

describe('CLI command parser', () => {
  it('parses a generic multi-publisher sync command', () => {
    expect(parseCliCommand({
      argv: [
        'sync',
        '--site', 'example',
        '--publisher', 'wordpress-main,archive-main',
        '--only', 'health/first,health/second',
        '--expect', 'a'.repeat(64),
        '--dry-run',
        '--verbose',
      ],
    })).toEqual({
      kind: 'sync',
      siteId: 'example',
      registryPath: undefined,
      dryRun: true,
      verbose: true,
      publisherIds: ['wordpress-main', 'archive-main'],
      targetSlugs: ['health/first', 'health/second'],
      expectedPlanFingerprint: 'a'.repeat(64),
      force: false,
      deleteRemoteFiles: false,
    });
  });

  it('models import as an adapter capability instead of a WordPress flag', () => {
    expect(parseCliCommand({
      argv: ['import', '--publisher', 'wordpress-main', '--resource', 'example-post', '--dry-run'],
    })).toMatchObject({
      kind: 'import',
      publisherId: 'wordpress-main',
      resource: 'example-post',
      dryRun: true,
    });
  });

  it('rejects removed WordPress-specific and ambiguous options', () => {
    expect(() => parseCliCommand({ argv: ['sync', '--wp'] })).toThrow('Unknown CLI option "--wp"');
    expect(() => parseCliCommand({ argv: ['sync', '--only', 'post-one'] })).toThrow(
      '--only and --force require at least one --publisher selection'
    );
    expect(() => parseCliCommand({ argv: ['configure', '--dry-run'] })).toThrow(
      '--dry-run is not valid for the configure command'
    );
  });
});
