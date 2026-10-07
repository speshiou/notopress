import { z } from 'zod';

export function isSafeAssetPath(value: string): boolean {
  return !value.includes('\\') && !value.includes('\0') && !value.includes(':')
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export const SourceAssetFolderSchema = z.string().min(1).refine((value) =>
  isSafeAssetPath(value) && value.split('/').every((part) => !part.startsWith('_') && !part.startsWith('.')),
'Use a relative source asset folder under content.');
