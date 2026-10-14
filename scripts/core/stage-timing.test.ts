import { describe, expect, it, vi } from 'vitest';
import { createStageTimer, passthroughStageTimer, type StageTiming } from './stage-timing';

describe('createStageTimer', () => {
  it('returns results unchanged and reports elapsed time without operation data', async () => {
    const report = vi.fn();
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(350);
    const timer = createStageTimer({ now, report });
    const result = { privateValue: 'not-for-logs' };

    expect(await timer.measure({ stage: 'publisher.prepare', run: async () => result })).toBe(result);
    expect(report).toHaveBeenCalledExactlyOnceWith({
      stage: 'publisher.prepare', durationMs: 250, outcome: 'completed',
    });
  });

  it('reports failed stages without error details and preserves the original error', async () => {
    const report = vi.fn();
    const error = new Error('private-request-details');
    const timer = createStageTimer({ now: () => 0, report });

    await expect(timer.measure({ stage: 'storage.compare', run: async () => { throw error; } })).rejects.toBe(error);
    expect(report).toHaveBeenCalledExactlyOnceWith({
      stage: 'storage.compare', durationMs: 0, outcome: 'failed',
    });
  });

  it('reports nested stages independently rather than adding their durations', async () => {
    let time = 0;
    const reports: StageTiming[] = [];
    const timer = createStageTimer({ now: () => time, report: (timing) => reports.push(timing) });

    await timer.measure({ stage: 'build.total', run: async () => {
      time = 10;
      await timer.measure({ stage: 'build.render', run: async () => { time = 30; } });
      time = 40;
    } });

    expect(reports).toEqual([
      { stage: 'build.render', durationMs: 20, outcome: 'completed' },
      { stage: 'build.total', durationMs: 40, outcome: 'completed' },
    ]);
  });

  it('does not let reporting failures fail work or mask operation failures', async () => {
    const timer = createStageTimer({ now: () => 0, report: () => { throw new Error('report failed'); } });
    expect(await timer.measure({ stage: 'build.total', run: async () => 'result' })).toBe('result');
    const error = new Error('operation failed');
    await expect(timer.measure({ stage: 'build.total', run: async () => { throw error; } })).rejects.toBe(error);
  });

  it('allows core callers to omit telemetry without introducing side effects', async () => {
    const run = vi.fn(async () => 'result');
    expect(await passthroughStageTimer.measure({ stage: 'build.total', run })).toBe('result');
    expect(run).toHaveBeenCalledOnce();
  });
});
