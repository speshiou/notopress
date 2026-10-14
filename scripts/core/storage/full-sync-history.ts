import { z } from 'zod';
import { StorageTargetSchema, type StorageTarget } from './target';

export const FULL_SYNC_REMINDER_DAYS = 7;
export const FULL_SYNC_HISTORY_FILENAME = 'full-sync.json';

const HistorySchema = z.object({
  version: z.literal(1),
  target: StorageTargetSchema,
  completedAt: z.string().datetime({ offset: true }),
}).strict();

export type FullSyncHistory = {
  describe: (input: { target: StorageTarget; remind: boolean }) => Promise<string>;
  record: (input: { target: StorageTarget }) => Promise<void>;
};

export function createFullSyncHistory({ read, write, now }: {
  read: () => Promise<string>;
  write: (content: string) => Promise<void>;
  now: () => Date;
}): FullSyncHistory {
  return {
    async describe({ target, remind }) {
      let elapsedDays: number | undefined;
      let completedAt: string | undefined;
      try {
        const parsed = HistorySchema.safeParse(JSON.parse(await read()));
        if (parsed.success) {
          const history = parsed.data;
          const age = now().getTime() - Date.parse(history.completedAt);
          if (history.target.endpoint === target.endpoint && history.target.bucket === target.bucket
            && history.target.siteId === target.siteId && age >= 0) {
            completedAt = history.completedAt;
            elapsedDays = Math.floor(age / 86_400_000);
          }
        }
      } catch {
        // Missing or unreadable advisory history must not block publication.
      }
      const status = completedAt
        ? `Last successful full vault sync: ${completedAt} (${elapsedDays} day(s) ago).`
        : 'Last successful full vault sync: unknown for this storage destination.';
      if (!remind || (elapsedDays !== undefined && elapsedDays < FULL_SYNC_REMINDER_DAYS)) return status;
      return `${status}\nConsider a full vault sync. Review it first: notopress sync --site ${JSON.stringify(target.siteId)} --dry-run. This reminder does not start a sync.`;
    },
    async record({ target }) {
      const history = HistorySchema.parse({ version: 1, target, completedAt: now().toISOString() });
      await write(`${JSON.stringify(history, null, 2)}\n`);
    },
  };
}
