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
  payloadHash: string;
  intent: WordPressPublishIntent;
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
    payloadHash: operation.payloadHash,
  };
}

export function formatWordPressPublishPlan({
  plan,
}: {
  plan: WordPressPublishPlan;
}): string {
  return formatOperationPlan({
    label: 'WordPress publish plan',
    plan,
    serializeOperation: toSerializableWordPressPublishOperation,
  });
}
