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

    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    chains.set(key, settled);

    // Once this call settles, drop the entry — but only if nothing newer has queued behind it in
    // the meantime, since keys are arbitrary (e.g. user-chosen rule titles) and a long-running
    // service worker shouldn't accumulate one forever for a key nothing is waiting on anymore.
    settled.then(() => {
      if (chains.get(key) === settled) chains.delete(key);
    });

    return run;
  };
}
