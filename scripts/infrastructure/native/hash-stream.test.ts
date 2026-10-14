import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { computeContentHash } from '../../core/state/sync-state';
import { hashByteStream } from './hash-stream';

describe('storage streaming hashes', () => {
  it('hashes chunks without buffering an entire artifact', async () => {
    expect(await hashByteStream(Readable.from([Buffer.from('bo'), Buffer.from('dy')]))).toEqual({ size: 4, contentHash: computeContentHash('body') });
  });
  it('rejects non-byte streams', async () => {
    await expect(hashByteStream(Readable.from([123]))).rejects.toThrow('invalid bytes');
  });
});
