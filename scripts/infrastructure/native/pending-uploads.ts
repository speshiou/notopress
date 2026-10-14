import { readFile } from 'node:fs/promises';
import { parsePendingStorageKeys } from '../../core/storage/baseline';

export async function readPendingStorageKeys({ filePath, readText = (file: string) => readFile(file, 'utf8') }: {
  filePath?: string;
  readText?: (file: string) => Promise<string>;
}): Promise<string[]> {
  if (!filePath) return [];
  let source: string;
  try { source = await readText(filePath); }
  catch { throw new Error('Could not read pending uploads file.'); }
  return parsePendingStorageKeys(source);
}
