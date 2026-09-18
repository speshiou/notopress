import { describe, expect, it } from 'vitest';
import { createOperationPlan, formatOperationPlan } from './operation-plan';

type ExampleOperation = {
  action: 'write';
  path: string;
  content: string;
  contentHash: string;
};

function serializeOperation(operation: ExampleOperation) {
  return {
    action: operation.action,
    path: operation.path,
    contentHash: operation.contentHash,
  };
}

describe('operation plans', () => {
  const operation: ExampleOperation = {
    action: 'write',
    path: '_rendered/content/example.html',
    content: '<p>Rendered content</p>',
    contentHash: 'content-hash',
  };

  it('fingerprints the plan kind and serializable operations deterministically', () => {
    const first = createOperationPlan({
      kind: 'rendered-content',
      operations: [operation],
      serializeOperation,
    });
    const second = createOperationPlan({
      kind: 'rendered-content',
      operations: [operation],
      serializeOperation,
    });
    const otherKind = createOperationPlan({
      kind: 'wordpress',
      operations: [operation],
      serializeOperation,
    });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).not.toBe(otherKind.fingerprint);
  });

  it('formats machine-readable metadata without private operation payloads', () => {
    const plan = createOperationPlan({
      kind: 'rendered-content',
      operations: [operation],
      serializeOperation,
    });
    const output = formatOperationPlan({
      label: 'NotoPress operation plan',
      plan,
      serializeOperation,
    });

    expect(output).toContain('"kind": "rendered-content"');
    expect(output).not.toContain('<p>Rendered content</p>');
  });
});
