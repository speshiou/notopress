import path from 'path';
import { DEFAULT_THUMBNAIL_SIZES, THUMBNAILS_DIR } from './constants';

export const RESPONSIVE_IMAGE_SIZES = '(max-width: 768px) 100vw, 768px';

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff']);

export type ResponsiveImageDeps = {
  defaultThumbnailSizes: readonly number[];
  generatedThumbnailDir: string;
  responsiveImageSizes: string;
  supportedImageExtensions: ReadonlySet<string>;
  extname: (filePath: string) => string;
  parsePosixPath: (filePath: string) => { dir: string; name: string };
  encodeUri: (uri: string) => string;
};

export function createResponsiveImageHelpers(deps: ResponsiveImageDeps) {
  function normalizeThumbnailSizes(sizes: readonly number[] | undefined): number[] {
    const sourceSizes = sizes && sizes.length > 0 ? sizes : deps.defaultThumbnailSizes;
    return [...new Set(sourceSizes.filter((size) => Number.isInteger(size) && size > 0))].sort((a, b) => a - b);
  }

  function isSupportedResponsiveImage(filePath: string): boolean {
    return deps.supportedImageExtensions.has(deps.extname(filePath).toLowerCase());
  }

  function isGeneratedThumbnailPath(filePath: string): boolean {
    return filePath.split('/').includes(deps.generatedThumbnailDir);
  }

  function getThumbnailPath({ imagePath, width }: { imagePath: string; width: number }): string {
    const parsed = deps.parsePosixPath(imagePath.replace(/\\/g, '/'));
    const dir = parsed.dir ? `${parsed.dir}/` : '';
    return `${deps.generatedThumbnailDir}/${dir}${parsed.name}-${width}.webp`;
  }

  function getResponsiveImageAttributes({
    src,
    thumbnailSizes,
  }: {
    src: string;
    thumbnailSizes: readonly number[];
  }): { src: string; srcSet: string; sizes: string } | null {
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('#')) {
      return null;
    }

    const cleanSrc = src.replace(/^\//, '');
    if (!isSupportedResponsiveImage(cleanSrc) || isGeneratedThumbnailPath(cleanSrc)) {
      return null;
    }

    const sizes = normalizeThumbnailSizes(thumbnailSizes);
    if (sizes.length === 0) {
      return null;
    }

    const srcSet = sizes
      .map((size) => `${deps.encodeUri(`/${getThumbnailPath({ imagePath: cleanSrc, width: size })}`)} ${size}w`)
      .join(', ');
    return { src: deps.encodeUri(`/${cleanSrc}`), srcSet, sizes: deps.responsiveImageSizes };
  }

  return {
    normalizeThumbnailSizes,
    isSupportedResponsiveImage,
    isGeneratedThumbnailPath,
    getThumbnailPath,
    getResponsiveImageAttributes,
  };
}

const defaultResponsiveImageHelpers = createResponsiveImageHelpers({
  defaultThumbnailSizes: DEFAULT_THUMBNAIL_SIZES,
  generatedThumbnailDir: THUMBNAILS_DIR,
  responsiveImageSizes: RESPONSIVE_IMAGE_SIZES,
  supportedImageExtensions: SUPPORTED_IMAGE_EXTENSIONS,
  extname: path.extname,
  parsePosixPath: path.posix.parse,
  encodeUri: encodeURI,
});

export const normalizeThumbnailSizes = defaultResponsiveImageHelpers.normalizeThumbnailSizes;
export const isSupportedResponsiveImage = defaultResponsiveImageHelpers.isSupportedResponsiveImage;
export const isGeneratedThumbnailPath = defaultResponsiveImageHelpers.isGeneratedThumbnailPath;
export const getThumbnailPath = defaultResponsiveImageHelpers.getThumbnailPath;
export const getResponsiveImageAttributes = defaultResponsiveImageHelpers.getResponsiveImageAttributes;
