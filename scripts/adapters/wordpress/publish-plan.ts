import {
  createOperationPlan,
  formatOperationPlan,
  type OperationPlan,
} from '../../core/publishing/operation-plan';
import type {
  WordPressPublishContentType,
  WordPressPublishIntent,
} from './publish-payload';

export type WordPressPublishOperationAction = 'create' | 'update' | 'skip';

export type WordPressPublishOperation = {
  action: WordPressPublishOperationAction;
  sourceSlug: string;
  wordpressSlug: string;
  title: string;
  date: string;
  contentType: WordPressPublishContentType;
  restBase: 'posts' | 'pages';
  existingPostId: number | null;
  sourceHash: string;
  inputHash: string;
  payloadHash: string;
  intent?: WordPressPublishIntent;
};

export type WordPressPublishPlan = OperationPlan<WordPressPublishOperation>;

type SerializableWordPressPublishOperation = Omit<WordPressPublishOperation, 'intent'>;

export function createWordPressPublishPlan({
  operations,
}: {
  operations: readonly WordPressPublishOperation[];
}): WordPressPublishPlan {
  return createOperationPlan({
    kind: 'wordpress-publish',
    operations,
    serializeOperation: toSerializableWordPressPublishOperation,
  });
}

export function toSerializableWordPressPublishOperation(
  operation: WordPressPublishOperation
): SerializableWordPressPublishOperation {
  return {
    action: operation.action,
    sourceSlug: operation.sourceSlug,
    wordpressSlug: operation.wordpressSlug,
    title: operation.title,
    date: operation.date,
    contentType: operation.contentType,
    restBase: operation.restBase,
    existingPostId: operation.existingPostId,
    sourceHash: operation.sourceHash,
    inputHash: operation.inputHash,
    payloadHash: operation.payloadHash,
  };
}

export function formatWordPressPublishPlan({
  plan,
  verbose = false,
}: {
  plan: WordPressPublishPlan;
  verbose?: boolean;
}): string {
  const visibleOperations = verbose
    ? plan.operations
    : plan.operations.filter((operation) => operation.action !== 'skip');
  const visiblePlan: WordPressPublishPlan = { ...plan, operations: visibleOperations };
  const skippedCount = plan.operations.length - visibleOperations.length;
  return formatOperationPlan({
    label: verbose || skippedCount === 0
      ? 'WordPress publish plan'
      : `WordPress publish plan (${skippedCount} unchanged operation(s) omitted; use --verbose to show them)`,
    plan: visiblePlan,
    serializeOperation: toSerializableWordPressPublishOperation,
  });
}
