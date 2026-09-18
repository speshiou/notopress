import { spawn, type SpawnOptions } from 'child_process';

export async function runProcess({
  command,
  args,
  options,
}: {
  command: string;
  args: string[];
  options: SpawnOptions;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command "${command} ${args.join(' ')}" failed with code ${code}`));
    });
    child.on('error', reject);
  });
}
