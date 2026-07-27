/**
 * Storage mutations (rules, managed-tab tracking) are read-modify-write against
 * `browser.storage.local`, which has no compare-and-swap. Two contexts — two options pages, or a
 * popup and an options page — can each read the same old value and one silently clobber the
 * other's write. Routing every mutation through the single background instance and serializing
 * them there (see `registerBackgroundOp` + the caller's own lock) removes the race instead of
 * just narrowing it.
 */
type Handler = (...args: any[]) => Promise<any>;

const handlers = new Map<string, Handler>();
let isBackground = false;

/** Call once, from the background entrypoint, before any messages can arrive. */
export function markBackgroundContext(): void {
  isBackground = true;

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isRpcMessage(message)) return undefined;
    const handler = handlers.get(message.name);
    if (!handler) return undefined;

    return handler(...message.args).then(
      (result: unknown) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error: describeError(error) }),
    );
  });
}

interface RpcMessage {
  __rpc: true;
  name: string;
  args: unknown[];
}

function isRpcMessage(message: unknown): message is RpcMessage {
  return typeof message === "object" && message !== null && (message as { __rpc?: unknown }).__rpc === true;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Registers `fn` under `name` and returns a wrapper that always runs it in the background:
 * directly, if already there; otherwise by relaying the call over a runtime message. Call this at
 * module scope in the file that owns the storage, so `fn` is registered in every context (only the
 * background context's registration is ever consulted, via `markBackgroundContext`).
 */
export function registerBackgroundOp<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  handlers.set(name, fn as Handler);

  return async (...args: A): Promise<R> => {
    if (isBackground) return fn(...args);

    const response = await browser.runtime.sendMessage({ __rpc: true, name, args });
    if (!response.ok) throw new Error(response.error);
    return response.result as R;
  };
}
