export function debounce(fn: () => void, delayMs: number): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    timeoutId = setTimeout(fn, delayMs);
  };
}
