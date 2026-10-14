import { execFile } from 'node:child_process';

export type AwsCliRequest = { args: string[]; environment: NodeJS.ProcessEnv };
export type AwsCliRunner = (request: AwsCliRequest) => Promise<string>;

const execute: AwsCliRunner = ({ args, environment }) => new Promise((resolve, reject) => {
  execFile('aws', args, { env: environment, shell: false, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

export function createAwsCliRunner({ run = execute }: { run?: AwsCliRunner } = {}): AwsCliRunner {
  return async (request) => {
    try { return await run(request); }
    catch { throw new Error('AWS CLI operation failed. Check its installation and storage configuration; no writes will be retried automatically.'); }
  };
}

export const runAwsCli = createAwsCliRunner();
