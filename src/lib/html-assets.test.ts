import { describe, expect, it } from 'vitest';
import { collectHtmlAssetUrls } from './html-assets';

describe('rendered HTML asset discovery', () => {
  it('collects attributes and all responsive variants, decodes entities, and ignores literal examples', () => {
    const urls = collectHtmlAssetUrls({ html: '<img src="/image.webp" srcset="/small.webp 320w, /large.webp 640w"><a href="/file?a=1&amp;b=2">File</a><video poster="/poster.jpg"><source src="/clip.mp4"></video><pre>&lt;img src="/example.png"&gt;</pre><!-- <img src="/comment.png"> -->' });
    expect(urls).toEqual(['/clip.mp4', '/file?a=1&b=2', '/image.webp', '/large.webp', '/poster.jpg', '/small.webp']);
  });
});
