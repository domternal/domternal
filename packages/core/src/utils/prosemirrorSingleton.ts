/**
 * Detection for the one dependency mistake that breaks ProseMirror silently:
 * two copies of the same module loaded into one page.
 *
 * ProseMirror compares by identity, not by shape. `Fragment.from` rejects a
 * fragment built by another copy, `PluginKey` lookups miss, and
 * `instanceof CellSelection` is false for a selection the table commands
 * themselves produced. None of that is a size problem, and none of it is
 * gradual: the very first document a duplicated `prosemirror-model` touches
 * throws `Can not convert <> to a Fragment`, with a stack that names neither
 * of the two packages that disagreed.
 *
 * The registry lives on `globalThis` under a `Symbol.for` key on purpose. The
 * whole point is to be reachable from a SECOND copy of this very module, and
 * a module-scoped variable would be duplicated along with everything else and
 * see nothing.
 *
 * ## The contract callers must keep
 *
 * `copy` identifies which physical copy of `module` the caller is using, so
 * every caller registering the same `module` string MUST pass the same export
 * of it. Passing `Fragment` from one call site and `Schema` from another would
 * report a conflict where there is none, so the choice is fixed per module and
 * FROZEN across `@domternal/core`, `@domternal-pro/core` and every package
 * that registers through either:
 *
 * | module                | export           |
 * | --------------------- | ---------------- |
 * | `prosemirror-model`   | `Fragment`       |
 * | `prosemirror-state`   | `Plugin`         |
 * | `prosemirror-view`    | `EditorView`     |
 * | `prosemirror-transform` | `Transform`    |
 * | `prosemirror-tables`  | `CellSelection`  |
 * | `y-prosemirror`       | `ySyncPluginKey` |
 */
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';

/**
 * Two packages disagreeing about which copy of `module` they use.
 *
 * `message` is the whole story, already formatted: what broke, why it cannot
 * work, and the one-line fix for each package manager and bundler. Callers
 * decide only whether to warn or throw.
 */
export interface ProseMirrorCopyConflict {
  /** Package whose copies disagree, e.g. `prosemirror-model`. */
  module: string;
  /** Package that registered the copy the page settled on. */
  firstConsumer: string;
  /** Package that arrived with a different one. */
  secondConsumer: string;
  /** Ready-to-print explanation and fix. */
  message: string;
}

interface RegistryEntry {
  copy: object;
  consumer: string;
}

const REGISTRY_KEY = Symbol.for('domternal.prosemirror.copies');
const REPORTED_KEY = Symbol.for('domternal.prosemirror.copies.reported');

interface RegistryHost {
  [REGISTRY_KEY]: Map<string, RegistryEntry> | undefined;
  [REPORTED_KEY]: Set<string> | undefined;
}

/* `Symbol.for` keys are a shared global namespace, so the slot can already
   hold something this module did not write: a future version with a different
   shape, or an unrelated library that picked the same string. Reading `.get`
   off that would throw from inside `new Editor(...)` and break the editor over
   a diagnostic, which is a worse failure than the one being diagnosed. Anything
   that is not the expected container is replaced rather than trusted. */
function registry(): Map<string, RegistryEntry> {
  const host = globalThis as unknown as RegistryHost;
  const existing = host[REGISTRY_KEY];
  if (existing instanceof Map) return existing;
  const fresh = new Map<string, RegistryEntry>();
  host[REGISTRY_KEY] = fresh;
  return fresh;
}

function reported(): Set<string> {
  const host = globalThis as unknown as RegistryHost;
  const existing = host[REPORTED_KEY];
  if (existing instanceof Set) return existing;
  const fresh = new Set<string>();
  host[REPORTED_KEY] = fresh;
  return fresh;
}

/** Per-manager fix lines, in the order a reader is most likely to need them. */
const FIXES = [
  'pnpm:    add the package to "pnpm.overrides" in package.json, then run `pnpm dedupe`',
  'npm:     add the package to "overrides" in package.json, then reinstall',
  'yarn:    add the package to "resolutions" in package.json, then reinstall',
  "Vite:    resolve.dedupe: ['<module>']",
  'webpack: resolve.alias with an absolute path to the single copy',
];

const DOCS_URL = 'https://domternal.dev/v1/guides/single-prosemirror-copy/';

/**
 * Builds the message a conflict reports. Exported for tests and for callers
 * that want to prefix it; `registerProseMirrorCopy` already fills it in.
 */
function describeConflict(module: string, first: string, second: string): string {
  return [
    `Two different copies of "${module}" are loaded on this page.`,
    `"${first}" registered one, "${second}" arrived with another.`,
    'ProseMirror compares classes by identity, so objects made by one copy are',
    'rejected by the other and the editor fails as soon as the two meet.',
    '',
    'Force a single copy:',
    ...FIXES.map((line) => `  ${line.replace('<module>', module)}`),
    '',
    DOCS_URL,
  ].join('\n');
}

/**
 * Records which copy of `module` a package is using, and reports a conflict
 * when that disagrees with the copy already registered.
 *
 * Returns `null` on the first registration and on every later one that
 * matches, so the happy path costs one `Map` lookup. Registering a conflicting
 * copy does NOT replace the recorded one: the first registration wins, which
 * keeps `firstConsumer` stable no matter how many latecomers arrive.
 *
 * @param module Package name, e.g. `prosemirror-model`.
 * @param copy An export of that package, the same one for every caller. See
 *   the contract in this file's header.
 * @param consumer Package doing the registering, used in the message.
 */
export function registerProseMirrorCopy(
  module: string,
  copy: object,
  consumer: string
): ProseMirrorCopyConflict | null {
  const entries = registry();
  const existing = entries.get(module);
  if (!existing) {
    entries.set(module, { copy, consumer });
    return null;
  }
  if (existing.copy === copy) return null;
  return {
    module,
    firstConsumer: existing.consumer,
    secondConsumer: consumer,
    message: describeConflict(module, existing.consumer, consumer),
  };
}

/**
 * Registers a copy and throws when it conflicts.
 *
 * For the call sites where a duplicate is already fatal and the only question
 * is which error the developer reads: the collaboration binding, for one,
 * throws `Can not convert <> to a Fragment` from inside y-prosemirror one call
 * later, naming neither package involved.
 *
 * @throws ExtensionConfigurationError so `new Editor(...)` fails loudly rather
 *   than being swallowed by the per-extension error isolation.
 */
export function assertSingleProseMirrorCopy(module: string, copy: object, consumer: string): void {
  const conflict = registerProseMirrorCopy(module, copy, consumer);
  if (conflict) throw new ExtensionConfigurationError(conflict.message);
}

/**
 * Registers a copy and warns once per module, for call sites where a duplicate
 * is a strong signal but not necessarily fatal yet: two editors built from two
 * copies of the core work fine until a node crosses between them.
 *
 * Deduped through `globalThis` as well, so a page holding two copies of this
 * module still prints one warning rather than one per editor per copy.
 */
export function warnOnDuplicateProseMirrorCopy(
  module: string,
  copy: object,
  consumer: string
): ProseMirrorCopyConflict | null {
  const conflict = registerProseMirrorCopy(module, copy, consumer);
  if (!conflict) return null;
  const seen = reported();
  if (!seen.has(module)) {
    seen.add(module);
    /* The console is the only channel that reaches a developer who has not
       instrumented anything, and this is exactly the case they cannot
       diagnose without help. */
    // eslint-disable-next-line no-console
    console.warn(conflict.message);
  }
  return conflict;
}

/**
 * Drops the registry. Tests only: nothing in a running app should forget which
 * copies are live.
 *
 * @internal
 */
export function resetProseMirrorCopyRegistry(): void {
  const host = globalThis as unknown as RegistryHost;
  host[REGISTRY_KEY] = undefined;
  host[REPORTED_KEY] = undefined;
}
