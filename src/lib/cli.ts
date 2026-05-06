/**
 * Checks if a flag exists in process.argv
 */
export function hasFlag({ flag, alias }: { flag: string; alias?: string }): boolean {
  return process.argv.some(arg => arg === flag || (alias && arg === alias));
}

/**
 * Gets the value of a flag. If the flag is present but has no value,
 * or the value starts with '-', it returns undefined.
 */
export function getFlagValue({ flag, alias }: { flag: string; alias?: string }): string | undefined {
  const index = process.argv.findIndex(arg => arg === flag || (alias && arg === alias));
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (value && !value.startsWith('-')) {
    return value;
  }

  return undefined;
}
