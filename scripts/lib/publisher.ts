import type { OperationPlan } from './operation-plan';
import type { Registry, Site } from '../../src/domain/registry';
import type { VaultDirectoryIndex, VaultRootIndex } from '../../src/lib/vault';
import type { ContentSnapshot } from './content-snapshot';

export type PreparedPublisher<TOperation> = {
  id: string;
  label: string;
  plan: OperationPlan<TOperation>;
  apply: ({ dryRun }: { dryRun: boolean }) => Promise<void>;
};

export type PublisherPreparationContext = {
  site: Site;
  registry: Registry;
  allIndices: Map<string, VaultDirectoryIndex>;
  contentSnapshot: ContentSnapshot;
  rootIndex: VaultRootIndex;
  targetSlugs?: string[];
  force?: boolean;
  dryRun: boolean;
};

export type PublisherAdapter = {
  id: string;
  type: string;
  prepare: (context: PublisherPreparationContext) => Promise<PreparedPublisher<unknown> | null>;
};

export function createPublisherRegistry({
  adapters,
}: {
  adapters: readonly PublisherAdapter[];
}) {
  const adaptersById = new Map<string, PublisherAdapter>();
  for (const adapter of adapters) {
    if (adaptersById.has(adapter.id)) {
      throw new Error(`Duplicate publisher id "${adapter.id}".`);
    }
    adaptersById.set(adapter.id, adapter);
  }

  return {
    get({ id }: { id: string }): PublisherAdapter {
      const adapter = adaptersById.get(id);
      if (!adapter) {
        throw new Error(`Publisher "${id}" is not configured.`);
      }
      return adapter;
    },
    list(): readonly PublisherAdapter[] {
      return [...adaptersById.values()];
    },
  };
}

export function assertPublisherPlanFingerprint<TOperation>({
  publisher,
  expectedFingerprint,
}: {
  publisher: PreparedPublisher<TOperation>;
  expectedFingerprint?: string;
}): void {
  if (!expectedFingerprint) return;
  if (expectedFingerprint !== publisher.plan.fingerprint) {
    throw new Error(
      `${publisher.label} plan changed. Expected ${expectedFingerprint}, received ${publisher.plan.fingerprint}. Run the dry-run again and review the new plan before publishing.`
    );
  }
}

export async function applyPreparedPublisher<TOperation>({
  publisher,
  dryRun,
}: {
  publisher: PreparedPublisher<TOperation>;
  dryRun: boolean;
}): Promise<void> {
  await publisher.apply({ dryRun });
}

export type SelectedPublisher = {
  publisher: PreparedPublisher<unknown>;
  expectedFingerprint?: string;
};

export async function executePublication({
  publishers,
  applyCore,
  dryRun,
  onValidated,
}: {
  publishers: readonly SelectedPublisher[];
  applyCore: () => Promise<void>;
  dryRun: boolean;
  onValidated?: ({ selection }: { selection: SelectedPublisher }) => void;
}): Promise<void> {
  for (const selection of publishers) {
    assertPublisherPlanFingerprint({
      publisher: selection.publisher,
      expectedFingerprint: selection.expectedFingerprint,
    });
    onValidated?.({ selection });
  }

  await applyCore();

  for (const selection of publishers) {
    await applyPreparedPublisher({ publisher: selection.publisher, dryRun });
  }
}
