/** Hostname parsed from `url`, lowercased, or "" if `url` isn't a valid absolute URL. */
export function getHostname(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Whether `host` matches domain `pattern` at a label boundary, not as a raw substring — so a
 * "github.com" pattern doesn't match "notgithub.com", and "x.com" doesn't match "examplex.com".
 *
 * A pattern ending in "." (e.g. "amazon.") is a bare label meant to match across TLDs: "amazon."
 * matches "amazon.com", "www.amazon.com", and "amazon.co.uk", but not "notamazon.com".
 */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  if (!host || !pattern) return false;
  const normalized = pattern.toLowerCase();

  if (normalized.endsWith(".")) {
    const label = normalized.slice(0, -1);
    return host.split(".").includes(label);
  }

  return host === normalized || host.endsWith(`.${normalized}`);
}
