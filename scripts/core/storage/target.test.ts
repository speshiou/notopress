import { describe, expect, it } from 'vitest';
import { StorageTargetSchema } from './target';

describe('portable storage destinations', () => {
  it('normalizes public endpoint URLs and rejects credentials and unsafe prefixes', () => {
    const target = { endpoint: 'https://storage.example.com/', bucket: 'example-bucket', siteId: 'example-site' };
    expect(StorageTargetSchema.parse(target).endpoint).toBe('https://storage.example.com');
    for (const endpoint of ['broken', 'file:///tmp/example', 'https://user:secret@storage.example.com', 'https://storage.example.com?token=secret']) expect(StorageTargetSchema.safeParse({ ...target, endpoint }).success).toBe(false);
    expect(StorageTargetSchema.safeParse({ ...target, siteId: '../other' }).success).toBe(false);
    expect(StorageTargetSchema.safeParse({ ...target, bucket: 'example-bucket/other-site' }).success).toBe(false);
  });
});
