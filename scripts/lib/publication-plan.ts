import type { VaultRootIndex } from '../../src/lib/vault';
import type { ContentSnapshot } from './content-snapshot';
import {
  createOperationPlan,
  formatOperationPlan,
  type OperationPlan,
} from './operation-plan';
import type { PreparedPublisher } from './publisher';

type CoreBuildOperation = {
  deleteRemoteFiles: boolean;
  documents: readonly {
    sourceSlug: string;
    publicSlug: string;
    sourceHash: string;
  }[];
  routes: Readonly<Record<string, string>>;
  assets: readonly string[];
  responsiveImageWidths: Readonly<Record<string, readonly number[]>>;
};

export type CoreBuildPlan = OperationPlan<CoreBuildOperation>;

type PublicationSection = {
  id: string;
  kind: string;
  fingerprint: string;
};

export type PublicationPlan = OperationPlan<PublicationSection>;

export function createCoreBuildPlan({
  contentSnapshot,
  rootIndex,
  deleteRemoteFiles,
}: {
  contentSnapshot: ContentSnapshot;
  rootIndex: VaultRootIndex;
  deleteRemoteFiles: boolean;
}): CoreBuildPlan {
  const operation: CoreBuildOperation = {
    deleteRemoteFiles,
    documents: contentSnapshot.documents.map((document) => ({
      sourceSlug: document.sourceSlug,
      publicSlug: document.publicSlug,
      sourceHash: document.sourceHash,
    })),
    routes: rootIndex.routes || {},
    assets: rootIndex.assetFiles || rootIndex.publicFiles,
    responsiveImageWidths: rootIndex.responsiveImageWidths || {},
  };
  return createOperationPlan({
    kind: 'notopress-core-build',
    operations: [operation],
    serializeOperation: (value) => value,
  });
}

export function createPublicationPlan({
  corePlan,
  publishers,
}: {
  corePlan: CoreBuildPlan;
  publishers: readonly PreparedPublisher<unknown>[];
}): PublicationPlan {
  const sections: PublicationSection[] = [
    { id: 'notopress', kind: corePlan.kind, fingerprint: corePlan.fingerprint },
    ...publishers.map((publisher) => ({
      id: publisher.id,
      kind: publisher.plan.kind,
      fingerprint: publisher.plan.fingerprint,
    })),
  ];
  return createOperationPlan({
    kind: 'notopress-publication',
    operations: sections,
    serializeOperation: (section) => section,
  });
}

export function formatPublicationPlan({ plan }: { plan: PublicationPlan }): string {
  return formatOperationPlan({
    label: 'NotoPress publication plan',
    plan,
    serializeOperation: (section) => section,
  });
}
