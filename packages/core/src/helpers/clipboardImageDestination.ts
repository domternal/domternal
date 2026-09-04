import type { EditorView } from '@domternal/pm/view';

/** @experimental Explicit destination policy. Consumers must validate and bound their own material snapshot. */
export interface ClipboardImageDestinationPolicy {
  readonly nodeTypeName: string;
  readonly sourceAttribute: string;
  readonly inline: boolean;
  readonly allowEmbedded: boolean;
  readonly allowedMimeTypes: readonly string[];
  readonly maxFileBytes: number;
  readonly policyVersion: string;
}

interface Registration {
  readonly token: object;
  readonly readPolicy: () => ClipboardImageDestinationPolicy | undefined;
}

const destinations = new WeakMap<EditorView, Registration[]>();

/** Read lifetime again after invoking application code. */
function isDestroyed(view: EditorView): boolean { return view.isDestroyed; }

/** @experimental Register an explicit view capability without reading its policy. Dispose with its plugin view. */
export function registerClipboardImageDestination(
  view: EditorView,
  readPolicy: () => ClipboardImageDestinationPolicy | undefined,
): () => void {
  try { if (view.isDestroyed) return () => undefined; }
  catch { return () => undefined; }
  const token = {};
  let registrations = destinations.get(view);
  if (registrations === undefined) {
    registrations = [];
    destinations.set(view, registrations);
  }
  registrations.push({ token, readPolicy });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const current = destinations.get(view);
    if (current === undefined) return;
    const index = current.findIndex(registration => registration.token === token);
    if (index !== -1) current.splice(index, 1);
    if (current.length === 0) destinations.delete(view);
  };
}

/** @experimental Read only the latest active registration. Missing or failing policies never fall back silently. */
export function getClipboardImageDestination(view: EditorView): ClipboardImageDestinationPolicy | undefined {
  try {
    if (view.isDestroyed) return undefined;
    const registrations = destinations.get(view);
    const latest = registrations?.[registrations.length - 1];
    if (latest === undefined) return undefined;
    const policy = latest.readPolicy();
    const current = destinations.get(view);
    if (isDestroyed(view) || current?.[current.length - 1] !== latest) return undefined;
    return policy;
  } catch { return undefined; }
}
