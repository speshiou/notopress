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

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}
