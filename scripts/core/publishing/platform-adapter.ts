import { assertOperationPlanFingerprint, type OperationPlan } from './operation-plan';
import type { Registry, Site } from '../../../src/domain/registry';
import type { VaultDirectoryIndex, VaultRootIndex } from '../../../src/lib/vault';
import type { ContentSnapshot } from '../content/content-snapshot';

export type PreparedPublication<TOperation> = {
  id: string;
  label: string;
  plan: OperationPlan<TOperation>;
  apply: ({ dryRun }: { dryRun: boolean }) => Promise<void>;
};

export type PreparePublicationContext = {
  site: Site;
  registry: Registry;
  allIndices: Map<string, VaultDirectoryIndex>;
  contentSnapshot: ContentSnapshot;
  rootIndex: VaultRootIndex;
  targetSlugs?: string[];
  force?: boolean;
  dryRun: boolean;
  verbose: boolean;
};

export type ImportContentContext = {
  site: Site;
  registry: Registry;
  resource: string;
  dryRun: boolean;
};

export type ContentPlatformAdapter = {
  id: string;
  type: string;
  preparePublication: (context: PreparePublicationContext) => Promise<PreparedPublication<unknown> | null>;
  initializeState?: (context: PreparePublicationContext) => Promise<void>;
  importResource?: (context: ImportContentContext) => Promise<void>;
};

export function createPlatformRegistry({
  adapters,
}: {
  adapters: readonly ContentPlatformAdapter[];
}) {
  const adaptersById = new Map<string, ContentPlatformAdapter>();
  for (const adapter of adapters) {
    if (adaptersById.has(adapter.id)) {
      throw new Error(`Duplicate publisher id "${adapter.id}".`);
    }
    adaptersById.set(adapter.id, adapter);
  }

  return {
    get({ id }: { id: string }): ContentPlatformAdapter {
      const adapter = adaptersById.get(id);
      if (!adapter) {
        throw new Error(`Publisher "${id}" is not configured.`);
      }
      return adapter;
    },
    list(): readonly ContentPlatformAdapter[] {
      return [...adaptersById.values()];
    },
  };
}

export function assertPublicationTargetFingerprint<TOperation>({
  publication,
  expectedFingerprint,
}: {
  publication: PreparedPublication<TOperation>;
  expectedFingerprint?: string;
}): void {
  assertOperationPlanFingerprint({
    label: publication.label,
    plan: publication.plan,
    expectedFingerprint,
  });
}

export async function applyPreparedPublication<TOperation>({
  publication,
  dryRun,
}: {
  publication: PreparedPublication<TOperation>;
  dryRun: boolean;
}): Promise<void> {
  await publication.apply({ dryRun });
}

export type PublicationTarget = {
  publication: PreparedPublication<unknown>;
  expectedFingerprint?: string;
};

export async function executePublication({
  targets,
  applyNativeSite,
  dryRun,
  onValidated,
}: {
  targets: readonly PublicationTarget[];
  applyNativeSite: () => Promise<void>;
  dryRun: boolean;
  onValidated?: ({ target }: { target: PublicationTarget }) => void;
}): Promise<void> {
  for (const target of targets) {
    assertPublicationTargetFingerprint({
      publication: target.publication,
      expectedFingerprint: target.expectedFingerprint,
    });
    onValidated?.({ target });
  }

  await applyNativeSite();

  for (const target of targets) {
    await applyPreparedPublication({ publication: target.publication, dryRun });
  }
}
