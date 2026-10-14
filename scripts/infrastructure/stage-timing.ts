import { performance } from 'node:perf_hooks';
import { createStageTimer } from '../core/stage-timing';

export const publicationStageTimer = createStageTimer({
  now: () => performance.now(),
  report: ({ stage, durationMs, outcome }) => {
    console.log(`[TIMING] ${stage}: ${(durationMs / 1000).toFixed(3)}s (${outcome})`);
  },
});
