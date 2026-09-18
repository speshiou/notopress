import type { VaultRootIndex } from '../../../src/lib/vault';
import type { ContentSnapshot } from '../content/content-snapshot';
import {
  createOperationPlan,
  formatOperationPlan,
  type OperationPlan,
} from './operation-plan';
import type { PreparedPublication } from './platform-adapter';
import type { RenderedContentArtifact } from '../content/rendered-content';

type NativeSiteManifest = {
  deleteRemoteFiles: boolean;
  documents: readonly {
    sourceSlug: string;
    publicSlug: string;
    sourceHash: string;
  }[];
  routes: Readonly<Record<string, string>>;
  assets: readonly string[];
  responsiveImageWidths: Readonly<Record<string, readonly number[]>>;
  renderedArtifacts: readonly RenderedContentArtifact[];
};

export type NativeSitePlan = OperationPlan<NativeSiteManifest>;

type PlanComponent = {
  id: string;
  kind: string;
  fingerprint: string;
};

export type PublicationPlan = OperationPlan<PlanComponent>;

export function createNativeSitePlan({
  contentSnapshot,
  rootIndex,
  renderedArtifacts,
  deleteRemoteFiles,
}: {
  contentSnapshot: ContentSnapshot;
  rootIndex: VaultRootIndex;
  renderedArtifacts: readonly RenderedContentArtifact[];
  deleteRemoteFiles: boolean;
}): NativeSitePlan {
  const manifest: NativeSiteManifest = {
    deleteRemoteFiles,
    documents: contentSnapshot.documents.map((document) => ({
      sourceSlug: document.sourceSlug,
      publicSlug: document.publicSlug,
      sourceHash: document.sourceHash,
    })),
    routes: rootIndex.routes || {},
    assets: rootIndex.assetFiles || rootIndex.publicFiles,
    responsiveImageWidths: rootIndex.responsiveImageWidths || {},
    renderedArtifacts,
  };
  return createOperationPlan({
    kind: 'notopress-core-build',
    operations: [manifest],
    serializeOperation: (value) => value,
  });
}

export function createPublicationPlan({
  nativeSitePlan,
  publications,
}: {
  nativeSitePlan: NativeSitePlan;
  publications: readonly PreparedPublication<unknown>[];
}): PublicationPlan {
  const components: PlanComponent[] = [
    { id: 'notopress', kind: nativeSitePlan.kind, fingerprint: nativeSitePlan.fingerprint },
    ...publications.map((publication) => ({
      id: publication.id,
      kind: publication.plan.kind,
      fingerprint: publication.plan.fingerprint,
    })),
  ];
  return createOperationPlan({
    kind: 'notopress-publication',
    operations: components,
    serializeOperation: (component) => component,
  });
}

export function formatPublicationPlan({ plan }: { plan: PublicationPlan }): string {
  return formatOperationPlan({
    label: 'NotoPress publication plan',
    plan,
    serializeOperation: (component) => component,
  });
}
