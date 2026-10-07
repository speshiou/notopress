import path from 'node:path';
import { z } from 'zod';
import { safelyDecodeUriComponent } from '../../../src/lib/local-images';

const MediaSchema = z.object({
  source_url: z.string().url(),
  media_details: z.object({
    original_image: z.string().optional(),
    sizes: z.record(z.string(), z.object({ source_url: z.string().url() })).optional(),
  }).optional(),
});
const MediaListSchema = z.array(MediaSchema);

export function createWordPressOriginalFetcher({ requestMedia, download }: {
  requestMedia: (input: { path: string }) => Promise<unknown>;
  download: (url: string) => Promise<Buffer | null>;
}) {
  return async ({ source, candidates, hosted }: {
    source: string;
    candidates: readonly string[];
    hosted: boolean;
  }): Promise<{ url: string; bytes: Buffer }> => {
    let originalUrls = [...candidates];
    if (!hosted && originalUrls.length === 0) {
      const sourceUrl = new URL(source);
      const filename = path.posix.basename(sourceUrl.pathname);
      const ext = path.posix.extname(filename);
      const stem = path.posix.basename(filename, ext).replace(/-(?:\d+x\d+|scaled)$/, '');
      const media = MediaListSchema.parse(await requestMedia({
        path: `/wp/v2/media?search=${encodeURIComponent(safelyDecodeUriComponent({ value: stem }))}&per_page=100&context=edit`,
      }));
      const sameImage = (value: string) => {
        const candidate = new URL(value);
        return candidate.origin === sourceUrl.origin && candidate.pathname === sourceUrl.pathname;
      };
      const matches = media.filter((item) => sameImage(item.source_url)
        || Object.values(item.media_details?.sizes || {}).some((size) => sameImage(size.source_url)));
      if (matches.length > 1) throw new Error(`Ambiguous WordPress media source: ${source}`);
      const match = matches[0];
      if (match) {
        const original = match.media_details?.original_image;
        originalUrls = [original ? new URL(encodeURIComponent(original), match.source_url).href : match.source_url];
      } else {
        // For external media WordPress has no metadata. Request the unsized source,
        // and never silently substitute a lower resolution thumbnail.
        sourceUrl.pathname = sourceUrl.pathname.replace(/-(?:\d+x\d+|scaled)(?=\.[^/.]+$)/, '');
        originalUrls = [sourceUrl.href];
      }
    }
    const found: { url: string; bytes: Buffer }[] = [];
    for (const url of originalUrls) {
      const bytes = await download(url);
      if (bytes) found.push({ url, bytes });
    }
    if (found.length > 1) throw new Error(`Ambiguous hosted original for ${source}. Restore its recorded original path.`);
    const original = found[0];
    if (!original) throw new Error(`Original image is unavailable for ${source}. Import stopped; no thumbnail fallback was saved.`);
    return original;
  };
}
