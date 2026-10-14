export type PublicationStage =
  | 'publication.total'
  | 'build.total'
  | 'build.agent-rules'
  | 'build.indices'
  | 'build.content-scan'
  | 'build.thumbnails.content'
  | 'build.thumbnails.public'
  | 'build.asset-scan'
  | 'build.include-scan'
  | 'build.snapshot'
  | 'build.render'
  | 'build.sitemaps'
  | 'publisher.prepare'
  | 'storage.compare'
  | 'storage.inventory'
  | 'storage.snapshot'
  | 'storage.recheck'
  | 'storage.sync';

export type StageTiming = {
  stage: PublicationStage;
  durationMs: number;
  outcome: 'completed' | 'failed';
};

export type StageTimer = {
  measure: <T>(input: { stage: PublicationStage; run: () => Promise<T> }) => Promise<T>;
};

export const passthroughStageTimer: StageTimer = {
  measure: ({ run }) => run(),
};

export function createStageTimer({ now, report }: {
  now: () => number;
  report: (timing: StageTiming) => void;
}): StageTimer {
  return {
    async measure({ stage, run }) {
      const startedAt = now();
      let outcome: StageTiming['outcome'] = 'failed';
      try {
        const result = await run();
        outcome = 'completed';
        return result;
      } finally {
        // Telemetry must never change publication results or mask the original error.
        try {
          report({ stage, durationMs: Math.max(0, now() - startedAt), outcome });
        } catch {
          // Reporting is observational and cannot fail the operation.
        }
      }
    },
  };
}
