import { describe, expect, it, vi } from 'vitest';
import { createWordPressOriginalFetcher } from './import-original';

const source = 'https://wordpress.example.com/uploads/image-640x480.jpg';
const original = 'https://wordpress.example.com/uploads/image.jpg';

describe('WordPress original image fetching', () => {
  it('uses media metadata to recover the full unscaled original', async () => {
    const download = vi.fn(async () => Buffer.from('original'));
    const requestMedia = vi.fn(async () => [{
      source_url: 'https://wordpress.example.com/uploads/image-scaled.jpg',
      media_details: { original_image: 'image.jpg', sizes: { medium: { source_url: source } } },
    }]);
    const fetch = createWordPressOriginalFetcher({ requestMedia, download });
    expect(await fetch({ source, candidates: [], hosted: false })).toMatchObject({ url: original });
    expect(download).toHaveBeenCalledExactlyOnceWith(original);
  });

  it('never substitutes the thumbnail when the original is unavailable', async () => {
    const download = vi.fn(async () => null);
    const fetch = createWordPressOriginalFetcher({ requestMedia: async () => [], download });
    await expect(fetch({ source, candidates: [], hosted: false })).rejects.toThrow('no thumbnail fallback');
    expect(download).toHaveBeenCalledExactlyOnceWith(original);
  });

  it('fails when multiple possible hosted originals exist', async () => {
    const fetch = createWordPressOriginalFetcher({ requestMedia: async () => [], download: async () => Buffer.from('image') });
    await expect(fetch({ source, hosted: true, candidates: [original, original.replace('.jpg', '.png')] })).rejects.toThrow('Ambiguous');
  });

  it('does not call media discovery for a known hosted original', async () => {
    const requestMedia = vi.fn();
    const fetch = createWordPressOriginalFetcher({ requestMedia, download: async () => Buffer.from('image') });
    await fetch({ source, candidates: [original], hosted: true });
    expect(requestMedia).not.toHaveBeenCalled();
  });
  it('matches cache-busted thumbnails to media metadata', async () => {
    const fetch = createWordPressOriginalFetcher({
      requestMedia: async () => [{
        source_url: original,
        media_details: { sizes: { medium: { source_url: source } } },
      }],
      download: async () => Buffer.from('original'),
    });
    expect((await fetch({ source: `${source}?version=2`, candidates: [], hosted: false })).url).toBe(original);
  });

});
