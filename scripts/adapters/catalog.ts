import type { Site } from '../../src/domain/registry';
import type { ContentPlatformAdapter } from '../core/publishing/platform-adapter';
import {
  createWordPressPlatformAdapters,
} from './wordpress/adapter';

export function createConfiguredPlatformAdapters({ site }: { site: Site }): ContentPlatformAdapter[] {
  return [
    ...createWordPressPlatformAdapters({ site }),
  ];
}
