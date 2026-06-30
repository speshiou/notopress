export function safelyDecodeUriComponent({ value, maxPasses = 3 }: { value: string; maxPasses?: number }): string {
  let decodedValue = value;
  for (let attempt = 0; attempt < maxPasses; attempt += 1) {
    try {
      const nextValue = decodeURIComponent(decodedValue);
      if (nextValue === decodedValue) {
        return decodedValue;
      }
      decodedValue = nextValue;
    } catch {
      return decodedValue;
    }
  }
  return decodedValue;
}

export function isExternalOrInlineAsset({ src }: { src: string }): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("#")
  );
}

export function resolveLocalImagePath({
  src,
  availableFiles,
}: {
  src: string;
  availableFiles?: readonly string[];
}): string {
  const cleanSrc = safelyDecodeUriComponent({ value: src.replace(/^\//, "") });
  if (!availableFiles || availableFiles.length === 0) {
    return cleanSrc;
  }

  const availableFileSet = new Set(availableFiles);
  if (availableFileSet.has(cleanSrc)) {
    return cleanSrc;
  }

  const pathParts = cleanSrc.split("/");
  const basename = pathParts[pathParts.length - 1] || cleanSrc;
  const basenameMatches = availableFiles.filter((file) => {
    const fileParts = file.split("/");
    return fileParts[fileParts.length - 1] === basename;
  });

  return basenameMatches.length === 1 ? basenameMatches[0] : cleanSrc;
}

export function resolveMarkdownImagePaths({
  markdown,
  availableFiles,
}: {
  markdown: string;
  availableFiles: readonly string[];
}): string {
  return markdown.replace(/!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)([^)]*)\)/g, (match, alt, rawUrl, suffix) => {
    const url = rawUrl.startsWith("<") && rawUrl.endsWith(">") ? rawUrl.slice(1, -1) : rawUrl;
    if (isExternalOrInlineAsset({ src: url })) {
      return match;
    }

    const resolvedPath = resolveLocalImagePath({ src: url, availableFiles });
    const trimmedSuffix = suffix.trim();
    const suffixText = trimmedSuffix ? ` ${trimmedSuffix}` : "";
    return `![${alt}](<${resolvedPath}>${suffixText})`;
  });
}
