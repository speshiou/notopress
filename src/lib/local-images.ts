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

type LocalImageIndex = {
  availableFileSet: ReadonlySet<string>;
  filesByBasename: ReadonlyMap<string, readonly string[]>;
};

const imageIndexCache = new WeakMap<readonly string[], LocalImageIndex>();

function getLocalImageIndex(availableFiles: readonly string[]): LocalImageIndex {
  const cachedIndex = imageIndexCache.get(availableFiles);
  if (cachedIndex) {
    return cachedIndex;
  }

  const basenameMap = new Map<string, string[]>();
  for (const file of availableFiles) {
    const fileParts = file.split("/");
    const basename = fileParts[fileParts.length - 1] || file;
    const matches = basenameMap.get(basename) || [];
    matches.push(file);
    basenameMap.set(basename, matches);
  }

  const index: LocalImageIndex = {
    availableFileSet: new Set(availableFiles),
    filesByBasename: basenameMap,
  };
  imageIndexCache.set(availableFiles, index);
  return index;
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

  const imageIndex = getLocalImageIndex(availableFiles);
  if (imageIndex.availableFileSet.has(cleanSrc)) {
    return cleanSrc;
  }

  const pathParts = cleanSrc.split("/");
  const basename = pathParts[pathParts.length - 1] || cleanSrc;
  const basenameMatches = imageIndex.filesByBasename.get(basename) || [];

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
