import type { Registry, Site } from '../../src/domain/registry';
import type { InitializeStorageStateCommand } from '../cli/command';
import type { StageTimer } from '../core/stage-timing';
import { formatStorageBaselinePlan } from '../core/storage/baseline';
import { prepareNativeBaseline } from '../infrastructure/native/storage-baseline';
import { readPendingStorageKeys } from '../infrastructure/native/pending-uploads';
import { buildSite } from './build-site';

export async function initializeStorage({ command, site, registry, stageTimer }: {
  command: InitializeStorageStateCommand;
  site: Site;
  registry: Registry;
  stageTimer: StageTimer;
}): Promise<void> {
  if (!command.trustLocal) throw new Error('Storage initialization requires explicit --trust-local.');
  if (!command.dryRun && !command.expectedPlanFingerprint) throw new Error('Live storage initialization requires a reviewed --expect fingerprint.');
  const pendingKeys = await readPendingStorageKeys({ filePath: command.pendingFile });
  const build = await stageTimer.measure({ stage: 'build.total', run: () => buildSite({
    site, registry, dryRun: true, prepareOnly: true, verbose: command.verbose, stageTimer,
  }) });
  const baseline = await prepareNativeBaseline({
    site, registry, ...build, trustLocal: command.trustLocal, pendingKeys, stageTimer,
  });
  try {
    console.log(`\n${formatStorageBaselinePlan({ plan: baseline.plan, verbose: command.verbose })}`);
    await baseline.apply({ dryRun: command.dryRun, expectedFingerprint: command.expectedPlanFingerprint });
    console.log(command.dryRun ? '\nStorage baseline preview completed; no state was written.' : '\nStorage baseline initialized. Review a new sync/publish dry run; previous publication fingerprints are obsolete.');
  } finally {
    baseline.close();
  }
}
