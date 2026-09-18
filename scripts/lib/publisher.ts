import type { OperationPlan } from './operation-plan';

export type PreparedPublisher<TOperation> = {
  id: string;
  label: string;
  plan: OperationPlan<TOperation>;
  apply: ({ dryRun }: { dryRun: boolean }) => Promise<void>;
};

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
