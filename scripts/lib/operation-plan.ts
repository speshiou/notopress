import { computeContentHash } from './sync-state';

export type OperationPlan<TOperation> = {
  version: 1;
  kind: string;
  fingerprint: string;
  operations: readonly TOperation[];
};

export function createOperationPlan<TOperation, TSerializableOperation>({
  kind,
  operations,
  serializeOperation,
}: {
  kind: string;
  operations: readonly TOperation[];
  serializeOperation: (operation: TOperation) => TSerializableOperation;
}): OperationPlan<TOperation> {
  const serializableOperations = operations.map(serializeOperation);
  const fingerprint = computeContentHash(JSON.stringify({
    version: 1,
    kind,
    operations: serializableOperations,
  }));

  return {
    version: 1,
    kind,
    fingerprint,
    operations,
  };
}

export function formatOperationPlan<TOperation, TSerializableOperation>({
  label,
  plan,
  serializeOperation,
}: {
  label: string;
  plan: OperationPlan<TOperation>;
  serializeOperation: (operation: TOperation) => TSerializableOperation;
}): string {
  return [
    `${label} ${plan.fingerprint}:`,
    JSON.stringify({
      version: plan.version,
      kind: plan.kind,
      fingerprint: plan.fingerprint,
      operations: plan.operations.map(serializeOperation),
    }, null, 2),
  ].join('\n');
}

export function assertOperationPlanFingerprint<TOperation>({
  label,
  plan,
  expectedFingerprint,
}: {
  label: string;
  plan: OperationPlan<TOperation>;
  expectedFingerprint?: string;
}): void {
  if (!expectedFingerprint) return;
  if (expectedFingerprint !== plan.fingerprint) {
    throw new Error(
      `${label} plan changed. Expected ${expectedFingerprint}, received ${plan.fingerprint}. Run the dry-run again and review the new plan before publishing.`
    );
  }
}
