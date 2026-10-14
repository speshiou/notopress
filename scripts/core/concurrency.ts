export async function mapWithConcurrency<TInput, TOutput>({
  items,
  concurrency,
  worker,
}: {
  items: readonly TInput[];
  concurrency: number;
  worker: (item: TInput, index: number) => Promise<TOutput>;
}): Promise<TOutput[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }

  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;

  async function runWorker(): Promise<void> {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error: unknown) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  if (failed) throw failure;
  return results;
}
