import { describe, it, expect } from "vitest";
import { getContentType, EXTENSION_MIME_MAP, DEFAULT_CONTENT_TYPE } from "./content-types";

describe("getContentType", () => {
  it("maps XML sitemap and feed extensions correctly", () => {
    expect(getContentType("sitemap.xml")).toBe("application/xml; charset=utf-8");
    expect(getContentType("public/sitemap_pages.xml")).toBe("application/xml; charset=utf-8");
    expect(getContentType("feed.xml")).toBe("application/xml; charset=utf-8");
    expect(getContentType("styles.xsl")).toBe("application/xml; charset=utf-8");
  });

  it("maps common image extensions correctly", () => {
    expect(getContentType("image.png")).toBe("image/png");
    expect(getContentType("photo.jpg")).toBe("image/jpeg");
    expect(getContentType("photo.jpeg")).toBe("image/jpeg");
    expect(getContentType("graphic.svg")).toBe("image/svg+xml");
    expect(getContentType("picture.webp")).toBe("image/webp");
    expect(getContentType("modern.avif")).toBe("image/avif");
    expect(getContentType("favicon.ico")).toBe("image/x-icon");
  });

  it("maps text and documents correctly", () => {
    expect(getContentType("document.pdf")).toBe("application/pdf");
    expect(getContentType("robots.txt")).toBe("text/plain; charset=utf-8");
    expect(getContentType("data.csv")).toBe("text/csv; charset=utf-8");
  });

  it("maps web assets and code correctly", () => {
    expect(getContentType("styles.css")).toBe("text/css; charset=utf-8");
    expect(getContentType("bundle.js")).toBe("application/javascript; charset=utf-8");
    expect(getContentType("module.mjs")).toBe("application/javascript; charset=utf-8");
    expect(getContentType("schema.json")).toBe("application/json; charset=utf-8");
  });

  it("maps font files correctly", () => {
    expect(getContentType("font.woff")).toBe("font/woff");
    expect(getContentType("font.woff2")).toBe("font/woff2");
    expect(getContentType("font.ttf")).toBe("font/ttf");
    expect(getContentType("font.otf")).toBe("font/otf");
  });

  it("maps media files correctly", () => {
    expect(getContentType("video.mp4")).toBe("video/mp4");
    expect(getContentType("video.webm")).toBe("video/webm");
    expect(getContentType("audio.mp3")).toBe("audio/mpeg");
    expect(getContentType("audio.wav")).toBe("audio/wav");
  });

  it("returns default octet-stream for unknown extensions or files without extension", () => {
    expect(getContentType("archive.bin")).toBe(DEFAULT_CONTENT_TYPE);
    expect(getContentType("unknownfile")).toBe(DEFAULT_CONTENT_TYPE);
    expect(getContentType("")).toBe(DEFAULT_CONTENT_TYPE);
  });

  it("supports custom mime mappings via dependency injection", () => {
    const customMap = {
      xyz: "application/x-custom",
    };
    expect(getContentType("file.xyz", customMap)).toBe("application/x-custom");
    expect(getContentType("file.png", customMap)).toBe(DEFAULT_CONTENT_TYPE);
  });

  it("handles uppercase extensions gracefully", () => {
    expect(getContentType("IMAGE.PNG")).toBe("image/png");
    expect(getContentType("SITEMAP.XML")).toBe("application/xml; charset=utf-8");
  });
});
