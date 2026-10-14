import { NOTOPRESS_DIR } from '../../../src/lib/constants';

export function isRelativeObjectPath(value: string): boolean {
  return value.length > 0 && !value.includes('\\') && !value.includes('\0')
    && !/^[a-zA-Z]:/.test(value)
    && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export function isPublishableVaultPath(value: string): boolean {
  return isRelativeObjectPath(value)
    && !value.split('/').some((segment) => ['.git', NOTOPRESS_DIR, '.DS_Store'].includes(segment));
}

export function getStorageKey({ siteId, path }: { siteId: string; path: string }): string {
  if (!isRelativeObjectPath(siteId) || !isRelativeObjectPath(path)) throw new Error('Invalid storage object path.');
  return `${siteId}/${path}`;
}
