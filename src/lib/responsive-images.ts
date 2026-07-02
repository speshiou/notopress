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

export type AssetUrlMode = "app-relative" | "absolute";

export type AssetUrlConfig = {
  imageHost?: string;
  siteId?: string;
  s3SubDir?: 'public' | 'content';
  mode?: AssetUrlMode;
};

export type ResponsiveImageAttributes = {
  src: string;
  srcSet: string;
  sizes: string;
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
    assetUrlConfig,
  }: {
    src: string;
    thumbnailSizes: readonly number[];
    assetUrlConfig?: AssetUrlConfig;
  }): ResponsiveImageAttributes | null {
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

    const mode = assetUrlConfig?.mode || 'app-relative';
    const largestWidth = sizes[sizes.length - 1];
    const toUrl = (filePath: string) => getAssetUrl({
      filePath,
      imageHost: assetUrlConfig?.imageHost,
      siteId: assetUrlConfig?.siteId,
      s3SubDir: assetUrlConfig?.s3SubDir || 'content',
      mode,
    });

    if (mode === 'absolute' && !assetUrlConfig?.imageHost) {
      return null;
    }

    const srcSet = sizes
      .map((size) => `${deps.encodeUri(toUrl(getThumbnailPath({ imagePath: cleanSrc, width: size })))} ${size}w`)
      .join(', ');
    return {
      src: deps.encodeUri(toUrl(getThumbnailPath({ imagePath: cleanSrc, width: largestWidth }))),
      srcSet,
      sizes: deps.responsiveImageSizes,
    };
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

export function getAssetUrl({
  imageHost,
  siteId,
  s3SubDir,
  filePath,
  mode = 'app-relative',
}: {
  imageHost?: string;
  siteId?: string;
  s3SubDir?: 'public' | 'content';
  filePath: string;
  mode?: AssetUrlMode;
}): string {
  const cleanPath = filePath.replace(/^\//, '');
  if (imageHost) {
    if (!siteId || !s3SubDir) {
      throw new Error('siteId and s3SubDir are required when imageHost is configured.');
    }
    return `${imageHost.replace(/\/+$/, '')}/${siteId}/${s3SubDir}/${cleanPath}`;
  }
  if (mode === 'absolute') {
    throw new Error('imageHost is required for absolute asset URLs.');
  }
  return `/api/vault-public/${cleanPath}`;
}
