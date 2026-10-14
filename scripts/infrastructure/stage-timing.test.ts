import { describe, expect, it, vi } from 'vitest';
import { publicationStageTimer } from './stage-timing';

describe('publicationStageTimer', () => {
  it('logs only the stage, seconds and outcome', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await publicationStageTimer.measure({ stage: 'storage.compare', run: async () => 'private-result' });
      expect(log).toHaveBeenCalledOnce();
      expect(log.mock.calls[0]).toEqual([
        expect.stringMatching(/^\[TIMING\] storage\.compare: \d+\.\d{3}s \(completed\)$/),
      ]);
    } finally {
      log.mockRestore();
    }
  });
});
