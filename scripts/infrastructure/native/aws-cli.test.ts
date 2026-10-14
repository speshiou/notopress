import { describe, expect, it, vi } from 'vitest';
import { createAwsCliRunner } from './aws-cli';

describe('AWS CLI process boundary', () => {
  it('returns successful output and never exposes process diagnostics or credentials on failure', async () => {
    const run = vi.fn(async () => 'preview');
    const runner = createAwsCliRunner({ run });
    expect(await runner({ args: ['--version'], environment: { NODE_ENV: 'test' } })).toBe('preview');
    const failed = createAwsCliRunner({ run: async () => { throw new Error('example-secret'); } });
    const result = failed({ args: ['s3', 'sync'], environment: { NODE_ENV: 'test', AWS_SECRET_ACCESS_KEY: 'example-secret' } });
    await expect(result).rejects.toThrow('AWS CLI operation failed');
    await expect(result).rejects.not.toThrow('example-secret');
  });
});
