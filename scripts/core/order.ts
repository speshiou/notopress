/** Locale-independent ordering for portable plans. */
export function compareStrings({ left, right }: { left: string; right: string }): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
