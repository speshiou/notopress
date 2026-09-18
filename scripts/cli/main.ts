import { getRegistry } from '../infrastructure/config/registry';
import { runCommand } from '../application/run-command';
import { parseCliCommand } from './command';

export async function runCli({ argv }: { argv: readonly string[] }): Promise<void> {
  const command = parseCliCommand({ argv });
  const registry = await getRegistry(command.registryPath);
  await runCommand({ command, registry });
}

runCli({ argv: process.argv.slice(2) }).catch((error: unknown) => {
  console.error('\n⨯ NotoPress command failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
