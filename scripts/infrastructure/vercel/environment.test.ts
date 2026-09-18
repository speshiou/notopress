import { describe, expect, it, vi } from 'vitest';
import { createVercelEnvironmentSynchronizer } from './environment';

describe('createVercelEnvironmentSynchronizer', () => {
  it('force-upserts variables without interactive stdin', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 0, stderr: '' });
    const syncEnvironment = createVercelEnvironmentSynchronizer({
      runCommand,
      log: vi.fn(),
      warn: vi.fn(),
    });
    const commandEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test', VERCEL_PROJECT_ID: 'project-id' };

    await syncEnvironment({
      variables: {
        API_TOKEN: 'secret-value',
        PUBLIC_URL: 'https://example.com',
      },
      metadata: {
        API_TOKEN: { isSensitive: true },
        PUBLIC_URL: { isSensitive: false },
      },
      commandEnv,
    });

    expect(runCommand).toHaveBeenNthCalledWith(1, {
      args: [
        'env', 'add', 'API_TOKEN', 'production', '--force', '--value', 'secret-value',
        '--yes', '--non-interactive', '--sensitive',
      ],
      env: commandEnv,
    });
    expect(runCommand).toHaveBeenNthCalledWith(2, {
      args: [
        'env', 'add', 'PUBLIC_URL', 'production', '--force', '--value', 'https://example.com',
        '--yes', '--non-interactive', '--no-sensitive',
      ],
      env: commandEnv,
    });
  });

  it('skips missing values and reports command failures', async () => {
    const runCommand = vi.fn().mockResolvedValue({ status: 1, stderr: 'permission denied' });
    const warn = vi.fn();
    const syncEnvironment = createVercelEnvironmentSynchronizer({
      runCommand,
      log: vi.fn(),
      warn,
    });

    await expect(syncEnvironment({
      variables: { EMPTY: undefined, API_TOKEN: 'secret-value' },
      metadata: { EMPTY: { isSensitive: false }, API_TOKEN: { isSensitive: true } },
      commandEnv: { NODE_ENV: 'test' },
    })).rejects.toThrow('Failed to synchronize Vercel environment variable API_TOKEN (status 1): permission denied');
    expect(warn).toHaveBeenCalledWith('⚠️  Warning: EMPTY is missing, skipping.');
  });
});
