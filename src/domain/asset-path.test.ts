import { describe, expect, it } from 'vitest';
import { SourceAssetFolderSchema } from './asset-path';

describe('source asset folders', () => {
  it('accepts nested relative source folders', () => {
    expect(SourceAssetFolderSchema.parse('media/images')).toBe('media/images');
  });
  it.each(['../images', '/images', 'images/../private', 'images\\nested', 'C:images', '_thumbnails', '.private/images', 'images//nested'])('rejects unsafe or generated folder %s', (folder) => {
    expect(SourceAssetFolderSchema.safeParse(folder).success).toBe(false);
  });
});
