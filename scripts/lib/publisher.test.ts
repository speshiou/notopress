import { describe, expect, it, vi } from 'vitest';
import { createOperationPlan } from './operation-plan';
import { applyPreparedPublisher, assertPublisherPlanFingerprint, executePublication } from './publisher';

function createPublisher() {
  const apply = vi.fn(async () => undefined);
  const plan = createOperationPlan({
    kind: 'example-publish',
    operations: [{ action: 'update', sourceSlug: 'example' }],
    serializeOperation: (operation) => operation,
  });
  return {
    apply,
    publisher: { id: 'example-main', label: 'Example', plan, apply },
  };
}

describe('prepared publisher lifecycle', () => {
  it('rejects a changed plan before apply', async () => {
    const { publisher, apply } = createPublisher();

    expect(() => assertPublisherPlanFingerprint({
      publisher,
      expectedFingerprint: 'different-fingerprint',
    })).toThrow('Example plan changed');
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies a validated publisher in the requested mode', async () => {
    const { publisher, apply } = createPublisher();

    assertPublisherPlanFingerprint({ publisher, expectedFingerprint: publisher.plan.fingerprint });
    await applyPreparedPublisher({ publisher, dryRun: true });

    expect(apply).toHaveBeenCalledWith({ dryRun: true });
  });

  it('validates every publisher before applying core or publisher mutations', async () => {
    const { publisher, apply } = createPublisher();
    const applyCore = vi.fn(async () => undefined);

    await expect(executePublication({
      publishers: [{ publisher, expectedFingerprint: 'different-fingerprint' }],
      applyCore,
      dryRun: false,
    })).rejects.toThrow('Example plan changed');

    expect(applyCore).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies core before selected publishers after all plans validate', async () => {
    const calls: string[] = [];
    const { publisher } = createPublisher();
    publisher.apply = vi.fn(async () => {
      calls.push('publisher');
    });

    await executePublication({
      publishers: [{ publisher, expectedFingerprint: publisher.plan.fingerprint }],
      applyCore: async () => {
        calls.push('core');
      },
      dryRun: false,
    });

    expect(calls).toEqual(['core', 'publisher']);
  });
});
