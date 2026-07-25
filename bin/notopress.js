#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const existsSync = require('fs').existsSync;

const NOTOPRESS_ROOT = path.resolve(__dirname, '..');
const deployScript = path.join(NOTOPRESS_ROOT, 'scripts', 'deploy.ts');

const rawArgs = process.argv.slice(2);

// Map command shortcuts: 'notopress sync ...' -> 'scripts/deploy.ts --sync ...'
const args = [];
if (rawArgs.length > 0 && !rawArgs[0].startsWith('-')) {
  const mode = rawArgs[0];
  if (mode === 'sync') args.push('--sync');
  else if (mode === 'deploy') args.push('--deploy');
  else if (mode === 'configure') args.push('--configure');
  else args.push(mode);
  args.push(...rawArgs.slice(1));
} else {
  args.push(...rawArgs);
}

const tsxBin = path.join(NOTOPRESS_ROOT, 'node_modules', '.bin', 'tsx');
const envFile = path.join(NOTOPRESS_ROOT, '.env');

const command = existsSync(tsxBin) ? tsxBin : 'npx';
const commandArgs = existsSync(tsxBin)
  ? (existsSync(envFile) ? ['--env-file=' + envFile, deployScript, ...args] : [deployScript, ...args])
  : ['tsx', ...(existsSync(envFile) ? ['--env-file=' + envFile] : []), deployScript, ...args];

const child = spawn(command, commandArgs, {
  cwd: NOTOPRESS_ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    NOTOPRESS_ROOT,
  },
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('Failed to execute Notopress CLI:', err.message);
  process.exit(1);
});
