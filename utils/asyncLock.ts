/**
 * A per-key async mutex: calls sharing a key are queued and run strictly one after another, so an
 * awaited read-modify-write (e.g. "read storage, compute next value, write storage") can't be
 * interleaved by another call racing the same key.
 */
export function createKeyedLock() {
  const chains = new Map<string, Promise<unknown>>();

  return function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    chains.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  };
}
