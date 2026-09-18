#!/usr/bin/env node

Promise.all([
  import('node:child_process'),
  import('node:path'),
  import('node:fs'),
]).then(([{ spawn }, pathModule, { existsSync }]) => {
  const path = pathModule.default;
  const notopressRoot = path.resolve(__dirname, '..');
  const cliScript = path.join(notopressRoot, 'scripts', 'cli', 'main.ts');
  const rawArgs = process.argv.slice(2);
  const tsxBin = path.join(notopressRoot, 'node_modules', '.bin', 'tsx');
  const envFile = path.join(notopressRoot, '.env');
  const command = existsSync(tsxBin) ? tsxBin : 'npx';
  const commandArgs = existsSync(tsxBin)
    ? (existsSync(envFile) ? ['--env-file=' + envFile, cliScript, ...rawArgs] : [cliScript, ...rawArgs])
    : ['tsx', ...(existsSync(envFile) ? ['--env-file=' + envFile] : []), cliScript, ...rawArgs];
  const child = spawn(command, commandArgs, {
    cwd: notopressRoot,
    stdio: 'inherit',
    env: { ...process.env, NOTOPRESS_ROOT: notopressRoot },
  });
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', (error) => {
    console.error('Failed to execute NotoPress CLI:', error.message);
    process.exit(1);
  });
}).catch((error) => {
  console.error('Failed to initialize NotoPress CLI:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
