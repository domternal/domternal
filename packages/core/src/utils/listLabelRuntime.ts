import type { Node as PMNode } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';
import type { ExtendedListLabel } from '../types/ListLabel.js';
import { nodeExtendedListLabel } from './listLabelAttribute.js';
import { compileListLabelStyles } from './listLabelStyles.js';

type StyleRoot = Document | ShadowRoot;
interface Registry {
  readonly owners: Map<object, readonly ExtendedListLabel[]>;
  readonly element: HTMLStyleElement;
}
const roots = new WeakMap<StyleRoot, Map<string | undefined, Registry>>();

function styleRoot(view: EditorView): StyleRoot {
  const root = view.dom.getRootNode();
  return root.nodeType === 11 && 'host' in root ? root as ShadowRoot : view.dom.ownerDocument;
}

function refresh(registry: Registry): void {
  const css = compileListLabelStyles([...registry.owners.values()].flat());
  if (registry.element.textContent !== css) registry.element.textContent = css;
}

function acquire(root: StyleRoot, nonce: string | undefined): Registry {
  let byNonce = roots.get(root);
  if (byNonce === undefined) { byNonce = new Map(); roots.set(root, byNonce); }
  let registry = byNonce.get(nonce);
  if (registry === undefined) {
    const document = root.nodeType === 9 ? root as Document : root.ownerDocument;
    if (document === null) throw new Error('A list label style root must have a document.');
    const element = document.createElement('style');
    element.setAttribute('data-domternal-list-labels', '');
    if (nonce !== undefined) element.setAttribute('nonce', nonce);
    (root.nodeType === 9 ? document.head : root).appendChild(element);
    registry = { owners: new Map(), element };
    byNonce.set(nonce, registry);
  }
  return registry;
}

export interface ListLabelStyleOwner { update(): void; destroy(): void }

/** A registry belongs to its actual document or shadow root and retains only live editor owners. */
export function createListLabelStyleOwner(view: EditorView, nonce: string | undefined): ListLabelStyleOwner {
  const owner = {};
  let root: StyleRoot | undefined;
  let rootDocument: Document | undefined;
  let owned: { root: StyleRoot; registry: Registry }[] = [];
  let document: PMNode | undefined;
  let labels: ExtendedListLabel[] = [];
  const release = (): void => {
    for (const { root, registry } of owned) {
      registry.owners.delete(owner);
      if (registry.owners.size === 0) {
        registry.element.remove(); roots.get(root)?.delete(nonce);
      } else refresh(registry);
    }
    root = undefined; rootDocument = undefined; owned = [];
  };
  return {
    update() {
      const changed = document !== view.state.doc;
      const nextRoot = styleRoot(view);
      const nextDocument = nextRoot.nodeType === 9 ? nextRoot as Document : nextRoot.ownerDocument;
      const changedRoot = nextRoot !== root || nextDocument !== rootDocument;
      if (!changed && !changedRoot) return;
      if (changed) {
        document = view.state.doc; labels = [];
        document.descendants(node => { const label = nodeExtendedListLabel(node); if (label !== null) labels.push(label); });
      }
      if (labels.length === 0 || changedRoot) release();
      if (labels.length === 0) return;
      root = nextRoot; rootDocument = nextDocument ?? undefined;
      if (owned.length === 0) {
        owned.push({ root, registry: acquire(root, nonce) });
        // Firefox and WebKit resolve counter definitions through the owner document,
        // while Chromium also supports definitions scoped to the shadow root.
        if (root.nodeType === 11 && root.ownerDocument !== null) {
          const documentRoot = root.ownerDocument;
          owned.push({ root: documentRoot, registry: acquire(documentRoot, nonce) });
        }
      }
      for (const { registry } of owned) { registry.owners.set(owner, labels); refresh(registry); }
    },
    destroy: release,
  };
}
