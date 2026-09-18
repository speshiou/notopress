import { describe, expect, it } from 'vitest';
import { createOperationPlan } from './operation-plan';
import { createNativeSitePlan, createPublicationPlan } from './publication-plan';
import type { PreparedPublication } from './platform-adapter';

const contentSnapshot = {
  documents: [{
    directory: 'guides',
    sourceSlug: 'guides/example',
    leafSlug: 'example',
    publicSlug: 'example',
    localPath: 'vault/content/guides/example.md',
    title: 'Example',
    date: '2026-01-01T00:00:00.000Z',
    taxonomies: {},
    frontmatter: {},
    markdown: 'Body',
    rawSource: '# Example\n\nBody',
    sourceHash: 'source-hash',
  }],
};

const rootIndex = {
  version: 1 as const,
  pages: [],
  directories: ['guides'],
  publicFiles: [],
  assetFiles: ['hero.png'],
  routes: { example: 'guides/example' },
  responsiveImageWidths: { 'hero.png': [320] },
};

const renderedArtifacts = [{
  path: '_rendered/content/guides/example.html',
  contentHash: 'rendered-hash',
}];

describe('publication plan', () => {
  it('changes when core source content or deletion policy changes', () => {
    const first = createNativeSitePlan({ contentSnapshot, rootIndex, renderedArtifacts, deleteRemoteFiles: false });
    const changedSource = createNativeSitePlan({
      contentSnapshot: {
        documents: [{ ...contentSnapshot.documents[0], sourceHash: 'changed-hash' }],
      },
      rootIndex,
      renderedArtifacts,
      deleteRemoteFiles: false,
    });
    const withDeletion = createNativeSitePlan({ contentSnapshot, rootIndex, renderedArtifacts, deleteRemoteFiles: true });
    const changedRender = createNativeSitePlan({
      contentSnapshot,
      rootIndex,
      renderedArtifacts: [{ ...renderedArtifacts[0], contentHash: 'changed-rendered-hash' }],
      deleteRemoteFiles: false,
    });

    expect(changedSource.fingerprint).not.toBe(first.fingerprint);
    expect(withDeletion.fingerprint).not.toBe(first.fingerprint);
    expect(changedRender.fingerprint).not.toBe(first.fingerprint);
  });

  it('combines core and adapter fingerprints into one reviewed publication', () => {
    const nativeSitePlan = createNativeSitePlan({ contentSnapshot, rootIndex, renderedArtifacts, deleteRemoteFiles: false });
    const adapterPlan = createOperationPlan({
      kind: 'example-publish',
      operations: [{ action: 'update' }],
      serializeOperation: (operation) => operation,
    });
    const publication: PreparedPublication<unknown> = {
      id: 'example-main',
      label: 'Example',
      plan: adapterPlan,
      apply: async () => undefined,
    };

    const plan = createPublicationPlan({ nativeSitePlan, publications: [publication] });

    expect(plan.operations).toEqual([
      { id: 'notopress', kind: 'notopress-core-build', fingerprint: nativeSitePlan.fingerprint },
      { id: 'example-main', kind: 'example-publish', fingerprint: adapterPlan.fingerprint },
    ]);
  });
});
