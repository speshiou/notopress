import { describe, expect, it, vi } from 'vitest';
import { createOperationPlan } from './operation-plan';
import {
  applyPreparedPublication,
  assertPublicationTargetFingerprint,
  createPlatformRegistry,
  executePublication,
  type ContentPlatformAdapter,
} from './platform-adapter';

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
  it('registers adapters by stable publisher id', () => {
    const adapter = { id: 'example-main', type: 'example', preparePublication: vi.fn() } satisfies ContentPlatformAdapter;
    const registry = createPlatformRegistry({ adapters: [adapter] });

    expect(registry.get({ id: 'example-main' })).toBe(adapter);
    expect(() => registry.get({ id: 'missing' })).toThrow('Publisher "missing" is not configured');
    expect(() => createPlatformRegistry({ adapters: [adapter, adapter] })).toThrow('Duplicate publisher id');
  });

  it('rejects a changed plan before apply', async () => {
    const { publisher, apply } = createPublisher();

    expect(() => assertPublicationTargetFingerprint({
      publication: publisher,
      expectedFingerprint: 'different-fingerprint',
    })).toThrow('Example plan changed');
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies a validated publisher in the requested mode', async () => {
    const { publisher, apply } = createPublisher();

    assertPublicationTargetFingerprint({ publication: publisher, expectedFingerprint: publisher.plan.fingerprint });
    await applyPreparedPublication({ publication: publisher, dryRun: true });

    expect(apply).toHaveBeenCalledWith({ dryRun: true });
  });

  it('validates every publisher before applying core or publisher mutations', async () => {
    const { publisher, apply } = createPublisher();
    const applyCore = vi.fn(async () => undefined);

    await expect(executePublication({
      targets: [{ publication: publisher, expectedFingerprint: 'different-fingerprint' }],
      applyNativeSite: applyCore,
      dryRun: false,
    })).rejects.toThrow('Example plan changed');

    expect(applyCore).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies core before selected publishers after all plans validate', async () => {
    const calls: string[] = [];
    const { publisher } = createPublisher();
    publisher.apply = vi.fn(async () => {
      calls.push('platform');
    });

    await executePublication({
      targets: [{ publication: publisher, expectedFingerprint: publisher.plan.fingerprint }],
      applyNativeSite: async () => {
        calls.push('core');
      },
      dryRun: false,
    });

    expect(calls).toEqual(['core', 'platform']);
  });
});
