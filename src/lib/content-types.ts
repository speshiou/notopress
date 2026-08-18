/**
 * Maps a file path or extension to its appropriate HTTP Content-Type header.
 */
export const EXTENSION_MIME_MAP: Record<string, string> = {
  // XML & Feeds
  xml: "application/xml; charset=utf-8",
  xsl: "application/xml; charset=utf-8",
  xslt: "application/xml; charset=utf-8",

  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",

  // Documents & Text
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",

  // Code & Web Assets
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",

  // Fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",

  // Media
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Returns the corresponding Content-Type header string for a given file path.
 */
export function getContentType(
  filePath: string,
  customMap: Record<string, string> = EXTENSION_MIME_MAP
): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext || !customMap[ext]) {
    return DEFAULT_CONTENT_TYPE;
  }
  return customMap[ext];
}
