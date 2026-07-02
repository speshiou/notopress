import { describe, expect, it } from "vitest";
import path from "path";
import { createResponsiveImageHelpers } from "./responsive-images";

describe("createResponsiveImageHelpers", () => {
  const helpers = createResponsiveImageHelpers({
    defaultThumbnailSizes: [640, 320, 640],
    generatedThumbnailDir: "_thumbnails",
    responsiveImageSizes: "100vw",
    supportedImageExtensions: new Set([".png", ".jpg"]),
    extname: path.posix.extname,
    parsePosixPath: path.posix.parse,
    encodeUri: encodeURI,
  });

  it("normalizes thumbnail sizes", () => {
    expect(helpers.normalizeThumbnailSizes(undefined)).toEqual([320, 640]);
    expect(helpers.normalizeThumbnailSizes([800, -1, 400, 400])).toEqual([400, 800]);
  });

  it("builds encoded responsive image attributes", () => {
    expect(
      helpers.getResponsiveImageAttributes({
        src: "/attachments/截圖 2026.png",
        thumbnailSizes: [320, 640],
      })
    ).toEqual({
      src: "/api/vault-public/_thumbnails/attachments/%E6%88%AA%E5%9C%96%202026-640.webp",
      srcSet:
        "/api/vault-public/_thumbnails/attachments/%E6%88%AA%E5%9C%96%202026-320.webp 320w, /api/vault-public/_thumbnails/attachments/%E6%88%AA%E5%9C%96%202026-640.webp 640w",
      sizes: "100vw",
    });
  });

  it("builds absolute CDN thumbnail URLs when imageHost is configured", () => {
    expect(
      helpers.getResponsiveImageAttributes({
        src: "/attachments/pic.png",
        thumbnailSizes: [320, 640],
        assetUrlConfig: {
          imageHost: "https://cdn.example.com",
          siteId: "site-a",
          s3SubDir: "content",
          mode: "absolute",
        },
      })
    ).toEqual({
      src: "https://cdn.example.com/site-a/content/_thumbnails/attachments/pic-640.webp",
      srcSet:
        "https://cdn.example.com/site-a/content/_thumbnails/attachments/pic-320.webp 320w, https://cdn.example.com/site-a/content/_thumbnails/attachments/pic-640.webp 640w",
      sizes: "100vw",
    });
  });

  it("does not generate absolute thumbnail URLs without imageHost", () => {
    expect(
      helpers.getResponsiveImageAttributes({
        src: "/attachments/pic.png",
        thumbnailSizes: [320],
        assetUrlConfig: { mode: "absolute", siteId: "site-a", s3SubDir: "content" },
      })
    ).toBeNull();
  });

  it("skips remote and generated thumbnail sources", () => {
    expect(helpers.getResponsiveImageAttributes({ src: "https://example.com/image.png", thumbnailSizes: [320] })).toBeNull();
    expect(helpers.getResponsiveImageAttributes({ src: "/_thumbnails/image-320.webp", thumbnailSizes: [320] })).toBeNull();
  });
});

