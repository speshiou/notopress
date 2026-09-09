export type UnescapedTableWikilink = {
  line: number;
  excerpt: string;
};

export function findUnescapedWikilinksInTables({
  markdown,
}: {
  markdown: string;
}): readonly UnescapedTableWikilink[] {
  const masked = maskProtectedSpans(markdown);
  const originalLines = markdown.split('\n');
  const maskedLines = masked.split('\n');
  const tableLineIndexes = findTableRowIndexes(maskedLines);
  const findings: UnescapedTableWikilink[] = [];

  for (const lineIndex of tableLineIndexes) {
    const line = maskedLines[lineIndex] ?? '';
    const wikilinkPattern = /!?\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null = wikilinkPattern.exec(line);
    while (match) {
      const content = match[1] ?? '';
      if (hasUnescapedPipe(content)) {
        const excerpt = (originalLines[lineIndex] ?? line).trim();
        findings.push({
          line: lineIndex + 1,
          excerpt: excerpt.length > 120 ? `${excerpt.slice(0, 117)}...` : excerpt,
        });
      }
      match = wikilinkPattern.exec(line);
    }
  }

  return findings;
}

export function formatUnescapedTableWikilinkWarning({
  filePath,
  issue,
}: {
  filePath: string;
  issue: UnescapedTableWikilink;
}): string {
  return `⚠️  Unescaped wikilink "|" in Markdown table (${filePath}:${issue.line}): ${issue.excerpt}. Use [[target\\|label]] so the table keeps its columns.`;
}

function maskProtectedSpans(markdown: string): string {
  const mask = (block: string) => block.replace(/[^\n]/g, ' ');
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, mask);
  return withoutFences.replace(/`[^`\n]+`/g, mask);
}

function findTableRowIndexes(lines: readonly string[]): readonly number[] {
  const indexes = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    if (!isTableSeparator(unwrapBlockquote(lines[index] ?? ''))) {
      continue;
    }

    if (index > 0 && lineContainsPipe(unwrapBlockquote(lines[index - 1] ?? ''))) {
      indexes.add(index - 1);
    }

    indexes.add(index);

    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const body = unwrapBlockquote(lines[bodyIndex] ?? '');
      if (!body.trim() || !lineContainsPipe(body)) {
        break;
      }
      indexes.add(bodyIndex);
    }
  }

  return [...indexes].sort((left, right) => left - right);
}

function unwrapBlockquote(line: string): string {
  return line.replace(/^(?:\s{0,3}>\s?)+/, '');
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return false;
  }

  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{1,}:?\s*$/.test(cell) && cell.trim().length > 0);
}

function lineContainsPipe(line: string): boolean {
  return line.includes('|');
}

function hasUnescapedPipe(content: string): boolean {
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '|' && content[index - 1] !== '\\') {
      return true;
    }
  }
  return false;
}
