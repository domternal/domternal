/** Private declarative policy; source HTML cannot manufacture a policy capability. */
declare const sourcePolicy: unique symbol;
export interface ClipboardResolvedSourcePolicy { readonly [sourcePolicy]: true }

const MAX_ORIGINS = 32;
const MAX_ORIGIN_UNITS = 2048;
const MAX_TOTAL_ORIGIN_UNITS = 8192;
const MAX_URL_UNITS = 8192;
const policies = new WeakMap<ClipboardResolvedSourcePolicy, ReadonlySet<string>>();

function boundedToken(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127 || code === 92) return false;
  }
  return true;
}

function absoluteHTTP(value: unknown, maximum: number): URL | undefined {
  if (!boundedToken(value, maximum) || !/^https?:\/\//iu.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.hostname !== '' && url.username === '' && url.password === '' && url.href.length <= maximum ? url : undefined;
  } catch { return undefined; }
}

/**
 * Compile exact origins once, before clipboard work. This never calls application code.
 * HTTP is allowed only when explicitly listed, including local development origins.
 * No path patterns, wildcards, relative references or implicit subdomains are supported.
 */
export function createClipboardResolvedSourcePolicy(input: readonly string[]): ClipboardResolvedSourcePolicy {
  const origins = new Set<string>();
  try {
    if (!Array.isArray(input) || input.length < 1 || input.length > MAX_ORIGINS) throw new RangeError();
    const count = input.length;
    let units = 0;
    for (let index = 0; index < count; index++) {
      const value: unknown = input[index];
      const url = absoluteHTTP(value, MAX_ORIGIN_UNITS);
      if (url === undefined || typeof value !== 'string' || value.includes('*') ||
        !/^https?:\/\/[^/?#]+\/?$/iu.test(value) || url.pathname !== '/' || url.search !== '' || url.hash !== '' ||
        value.length > MAX_TOTAL_ORIGIN_UNITS - units) throw new RangeError();
      units += value.length;
      origins.add(url.origin);
    }
  } catch { throw new RangeError('Invalid clipboard resolved image origins'); }
  const policy = Object.freeze(Object.create(null)) as ClipboardResolvedSourcePolicy;
  policies.set(policy, origins);
  return policy;
}

/** Validate a resolver output, not arbitrary source HTML. No network access or host callback. */
export function readClipboardResolvedSource(policy: ClipboardResolvedSourcePolicy, input: unknown): string | undefined {
  const origins = policies.get(policy);
  if (origins === undefined) return undefined;
  const url = absoluteHTTP(input, MAX_URL_UNITS);
  return url !== undefined && origins.has(url.origin) ? url.href : undefined;
}
