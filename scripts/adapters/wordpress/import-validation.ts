export type ImportValidationInput = {
  sourceContent: string;
  markdown: string;
};

function findDetachedTableRow(markdown: string): number | null {
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== '') continue;

    const previousLine = lines[index - 1]?.trim() || '';
    let nextIndex = index + 1;
    while (nextIndex < lines.length && lines[nextIndex].trim() === '') nextIndex += 1;
    const nextLine = lines[nextIndex]?.trim() || '';
    const lineAfterNext = lines[nextIndex + 1]?.trim() || '';
    const nextLineStartsNewTable = /^\|(?:\s*:?-{3,}:?\s*\|)+$/.test(lineAfterNext);
    if (previousLine.startsWith('|') && nextLine.startsWith('|') && !nextLineStartsNewTable) {
      return nextIndex + 1;
    }
  }
  return null;
}

export function validateImportedMarkdown({ sourceContent, markdown }: ImportValidationInput): void {
  if (sourceContent.trim().length > 0 && markdown.trim().length === 0) {
    throw new Error('WordPress import validation failed: non-empty source content converted to empty Markdown.');
  }

  const detachedTableRow = findDetachedTableRow(markdown);
  if (detachedTableRow !== null) {
    throw new Error(
      `WordPress import validation failed: Markdown table row at line ${detachedTableRow} is detached by a blank line.`
    );
  }
}
