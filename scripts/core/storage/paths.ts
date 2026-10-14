import { DEFAULT_REGISTRY_FILENAME, NOTOPRESS_DIR } from '../../../src/lib/constants';

export const STORAGE_MANIFEST_PATH = `${NOTOPRESS_DIR}/storage-manifest.json`;

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

export function isManagedStorageKey({ siteId, key }: { siteId: string; key: string }): boolean {
  return key === DEFAULT_REGISTRY_FILENAME
    || (key.startsWith(`${siteId}/`) && isPublishableVaultPath(key.slice(siteId.length + 1)));
}
