export type SharedCommandOptions = {
  siteId?: string;
  registryPath?: string;
  dryRun: boolean;
  verbose: boolean;
};

export type SyncCommand = SharedCommandOptions & {
  kind: 'sync' | 'deploy';
  deleteRemoteFiles: boolean;
};

export type PublishCommand = SharedCommandOptions & {
  kind: 'publish';
  publisherId: string;
  targetSlugs?: readonly string[];
  expectedPlanFingerprint?: string;
  force: boolean;
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

export type OperationalCommand =
  | SyncCommand
  | PublishCommand
  | ConfigureCommand
  | ImportCommand
  | InitializePublisherStateCommand;

export type CliInvocation =
  | OperationalCommand
  | { kind: 'help'; topic?: string }
  | { kind: 'version' };

type ParsedArguments = {
  positionals: string[];
  values: Map<string, string>;
  switches: Set<string>;
};

const VALUE_OPTIONS = new Set(['--site', '--registry', '--expect']);
const SWITCH_OPTIONS = new Set(['--dry-run', '--verbose', '--delete', '--force']);
const ALIASES = new Map([
  ['-s', '--site'],
  ['-r', '--registry'],
  ['-v', '--verbose'],
]);

function parseArguments(args: readonly string[]): ParsedArguments {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();
  let optionsEnded = false;

  for (let index = 0; index < args.length; index += 1) {
    const rawToken = args[index];
    if (rawToken === '--') {
      optionsEnded = true;
      continue;
    }
    if (optionsEnded || !rawToken.startsWith('-')) {
      positionals.push(rawToken);
      continue;
    }

    const token = ALIASES.get(rawToken) || rawToken;
    if (SWITCH_OPTIONS.has(token)) {
      if (switches.has(token)) throw new Error(`Option "${rawToken}" may only be provided once.`);
      switches.add(token);
      continue;
    }
    if (!VALUE_OPTIONS.has(token)) throw new Error(`Unknown option "${rawToken}".`);

    const value = args[index + 1];
    if (!value || value.startsWith('-')) throw new Error(`Option "${rawToken}" requires a value.`);
    if (values.has(token)) throw new Error(`Option "${rawToken}" may only be provided once.`);
    values.set(token, value);
    index += 1;
  }

  return { positionals, values, switches };
}

function sharedOptions(arguments_: ParsedArguments): SharedCommandOptions {
  return {
    siteId: arguments_.values.get('--site'),
    registryPath: arguments_.values.get('--registry'),
    dryRun: arguments_.switches.has('--dry-run'),
    verbose: arguments_.switches.has('--verbose'),
  };
}

function rejectUnsupportedOptions({
  arguments_,
  command,
  allowedValues,
  allowedSwitches,
}: {
  arguments_: ParsedArguments;
  command: string;
  allowedValues: readonly string[];
  allowedSwitches: readonly string[];
}): void {
  for (const option of arguments_.values.keys()) {
    if (!allowedValues.includes(option)) throw new Error(`${option} is not valid for "${command}".`);
  }
  for (const option of arguments_.switches) {
    if (!allowedSwitches.includes(option)) throw new Error(`${option} is not valid for "${command}".`);
  }
}

function optionalSite({ arguments_, command }: { arguments_: ParsedArguments; command: string }): string | undefined {
  if (arguments_.positionals.length > 1) {
    throw new Error(`Usage: notopress ${command} [site]`);
  }
  const positionalSite = arguments_.positionals[0];
  const optionSite = arguments_.values.get('--site');
  if (positionalSite && optionSite) throw new Error('Provide the site either positionally or with --site, not both.');
  return positionalSite || optionSite;
}

function assertFingerprint(fingerprint?: string): void {
  if (fingerprint && !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error('--expect requires the 64-character fingerprint printed by a dry-run.');
  }
}

function requirePositionals({
  positionals,
  count,
  usage,
}: {
  positionals: readonly string[];
  count: number;
  usage: string;
}): void {
  if (positionals.length !== count) throw new Error(`Usage: ${usage}`);
}

export function parseCliCommand({ argv }: { argv: readonly string[] }): CliInvocation {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    return { kind: 'help', topic: argv[0] === 'help' ? argv[1] : undefined };
  }
  if (argv[0] === '--version' || argv[0] === '-V' || argv[0] === 'version') return { kind: 'version' };

  const [commandName, ...commandArgs] = argv;
  if (commandArgs.includes('--help') || commandArgs.includes('-h')) return { kind: 'help', topic: commandName };
  const arguments_ = parseArguments(commandArgs);

  if (commandName === 'sync' || commandName === 'deploy') {
    rejectUnsupportedOptions({
      arguments_,
      command: commandName,
      allowedValues: ['--site', '--registry'],
      allowedSwitches: ['--dry-run', '--verbose', '--delete'],
    });
    return {
      ...sharedOptions(arguments_),
      siteId: optionalSite({ arguments_, command: commandName }),
      kind: commandName,
      deleteRemoteFiles: arguments_.switches.has('--delete'),
    };
  }

  if (commandName === 'publish') {
    rejectUnsupportedOptions({
      arguments_,
      command: commandName,
      allowedValues: ['--site', '--registry', '--expect'],
      allowedSwitches: ['--dry-run', '--verbose', '--delete', '--force'],
    });
    if (arguments_.positionals.length === 0) {
      throw new Error('Usage: notopress publish <publisher> [slug...]');
    }
    const [publisherId, ...targetSlugs] = arguments_.positionals;
    const expectedPlanFingerprint = arguments_.values.get('--expect');
    assertFingerprint(expectedPlanFingerprint);
    return {
      ...sharedOptions(arguments_),
      kind: 'publish',
      publisherId,
      targetSlugs: targetSlugs.length > 0 ? [...new Set(targetSlugs)] : undefined,
      expectedPlanFingerprint,
      force: arguments_.switches.has('--force'),
      deleteRemoteFiles: arguments_.switches.has('--delete'),
    };
  }

  if (commandName === 'configure') {
    rejectUnsupportedOptions({
      arguments_,
      command: commandName,
      allowedValues: ['--site', '--registry'],
      allowedSwitches: [],
    });
    return {
      ...sharedOptions(arguments_),
      siteId: optionalSite({ arguments_, command: commandName }),
      kind: 'configure',
    };
  }

  if (commandName === 'import') {
    rejectUnsupportedOptions({
      arguments_,
      command: commandName,
      allowedValues: ['--site', '--registry'],
      allowedSwitches: ['--dry-run', '--verbose'],
    });
    requirePositionals({
      positionals: arguments_.positionals,
      count: 2,
      usage: 'notopress import <publisher> <resource>',
    });
    return {
      ...sharedOptions(arguments_),
      kind: 'import',
      publisherId: arguments_.positionals[0],
      resource: arguments_.positionals[1],
    };
  }

  if (commandName === 'publisher') {
    rejectUnsupportedOptions({
      arguments_,
      command: 'publisher init',
      allowedValues: ['--site', '--registry'],
      allowedSwitches: ['--dry-run', '--verbose'],
    });
    requirePositionals({
      positionals: arguments_.positionals,
      count: 2,
      usage: 'notopress publisher init <publisher>',
    });
    if (arguments_.positionals[0] !== 'init') {
      throw new Error(`Unknown publisher action "${arguments_.positionals[0]}". Run "notopress help publisher".`);
    }
    return {
      ...sharedOptions(arguments_),
      kind: 'initialize-publisher-state',
      publisherId: arguments_.positionals[1],
    };
  }

  throw new Error(`Unknown command "${commandName}". Run "notopress help".`);
}
