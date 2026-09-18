export type SharedCommandOptions = {
  siteId?: string;
  registryPath?: string;
  dryRun: boolean;
  verbose: boolean;
};

export type PublishOptions = {
  publisherIds: readonly string[];
  targetSlugs?: readonly string[];
  expectedPlanFingerprint?: string;
  force: boolean;
};

export type SyncCommand = SharedCommandOptions & PublishOptions & {
  kind: 'sync' | 'deploy';
  deleteRemoteFiles: boolean;
};

export type ConfigureCommand = SharedCommandOptions & {
  kind: 'configure';
};

export type ImportCommand = SharedCommandOptions & {
  kind: 'import';
  publisherId: string;
  resource: string;
};

export type InitializePublisherStateCommand = SharedCommandOptions & {
  kind: 'initialize-publisher-state';
  publisherId: string;
};

export type CliCommand = SyncCommand | ConfigureCommand | ImportCommand | InitializePublisherStateCommand;

type ParsedTokens = {
  values: Map<string, string>;
  switches: Set<string>;
};

const VALUE_OPTIONS = new Set([
  '--site',
  '--registry',
  '--publisher',
  '--only',
  '--expect',
  '--resource',
]);
const SWITCH_OPTIONS = new Set(['--dry-run', '--verbose', '--delete', '--force']);
const ALIASES = new Map([
  ['-s', '--site'],
  ['-r', '--registry'],
  ['-v', '--verbose'],
]);

function parseTokens(args: readonly string[]): ParsedTokens {
  const values = new Map<string, string>();
  const switches = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const rawToken = args[index];
    const token = ALIASES.get(rawToken) || rawToken;
    if (SWITCH_OPTIONS.has(token)) {
      switches.add(token);
      continue;
    }
    if (!VALUE_OPTIONS.has(token)) {
      throw new Error(`Unknown CLI option "${rawToken}".`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(`CLI option "${rawToken}" requires a value.`);
    }
    if (values.has(token)) {
      throw new Error(`CLI option "${rawToken}" may only be provided once.`);
    }
    values.set(token, value);
    index += 1;
  }

  return { values, switches };
}

function parseList(value?: string): string[] {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) || [];
}

function requireValue({ tokens, option }: { tokens: ParsedTokens; option: string }): string {
  const value = tokens.values.get(option);
  if (!value) throw new Error(`Command requires ${option} <value>.`);
  return value;
}

function assertFingerprint(fingerprint?: string): void {
  if (fingerprint && !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error('--expect requires the 64-character fingerprint printed by a dry-run.');
  }
}

function sharedOptions(tokens: ParsedTokens): SharedCommandOptions {
  return {
    siteId: tokens.values.get('--site'),
    registryPath: tokens.values.get('--registry'),
    dryRun: tokens.switches.has('--dry-run'),
    verbose: tokens.switches.has('--verbose'),
  };
}

function rejectOptions({
  tokens,
  allowedValues,
  allowedSwitches,
  command,
}: {
  tokens: ParsedTokens;
  allowedValues: readonly string[];
  allowedSwitches: readonly string[];
  command: string;
}): void {
  for (const option of tokens.values.keys()) {
    if (!allowedValues.includes(option)) throw new Error(`${option} is not valid for the ${command} command.`);
  }
  for (const option of tokens.switches) {
    if (!allowedSwitches.includes(option)) throw new Error(`${option} is not valid for the ${command} command.`);
  }
}

export function parseCliCommand({ argv }: { argv: readonly string[] }): CliCommand {
  const [commandName = 'sync', ...optionArgs] = argv;
  const tokens = parseTokens(optionArgs);
  const shared = sharedOptions(tokens);

  if (commandName === 'sync' || commandName === 'deploy') {
    rejectOptions({
      tokens,
      allowedValues: ['--site', '--registry', '--publisher', '--only', '--expect'],
      allowedSwitches: ['--dry-run', '--verbose', '--delete', '--force'],
      command: commandName,
    });
    const publisherIds = parseList(tokens.values.get('--publisher'));
    const targetSlugs = parseList(tokens.values.get('--only'));
    const expectedPlanFingerprint = tokens.values.get('--expect');
    assertFingerprint(expectedPlanFingerprint);
    if ((targetSlugs.length > 0 || tokens.switches.has('--force')) && publisherIds.length === 0) {
      throw new Error('--only and --force require at least one --publisher selection.');
    }
    return {
      ...shared,
      kind: commandName,
      publisherIds,
      targetSlugs: targetSlugs.length > 0 ? targetSlugs : undefined,
      expectedPlanFingerprint,
      force: tokens.switches.has('--force'),
      deleteRemoteFiles: tokens.switches.has('--delete'),
    };
  }

  if (commandName === 'configure') {
    rejectOptions({
      tokens,
      allowedValues: ['--site', '--registry'],
      allowedSwitches: [],
      command: commandName,
    });
    return { ...shared, kind: 'configure' };
  }

  if (commandName === 'import') {
    rejectOptions({
      tokens,
      allowedValues: ['--site', '--registry', '--publisher', '--resource'],
      allowedSwitches: ['--dry-run', '--verbose'],
      command: commandName,
    });
    return {
      ...shared,
      kind: 'import',
      publisherId: requireValue({ tokens, option: '--publisher' }),
      resource: requireValue({ tokens, option: '--resource' }),
    };
  }

  if (commandName === 'initialize-publisher-state') {
    rejectOptions({
      tokens,
      allowedValues: ['--site', '--registry', '--publisher'],
      allowedSwitches: ['--dry-run', '--verbose'],
      command: commandName,
    });
    return {
      ...shared,
      kind: 'initialize-publisher-state',
      publisherId: requireValue({ tokens, option: '--publisher' }),
    };
  }

  throw new Error(`Unknown command "${commandName}".`);
}
