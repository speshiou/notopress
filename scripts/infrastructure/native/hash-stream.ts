import { createContentHasher } from '../../core/state/sync-state';

export async function hashByteStream(stream: AsyncIterable<unknown>): Promise<{ size: number; contentHash: string }> {
  const hash = createContentHasher();
  let size = 0;
  for await (const chunk of stream) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    if (!(bytes instanceof Uint8Array)) throw new Error('Storage stream returned invalid bytes.');
    size += bytes.byteLength;
    hash.update(bytes);
  }
  return { size, contentHash: hash.digest('hex') };
}
