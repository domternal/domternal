/**
 * Heading `tocId` assignment - predicate-skip pattern (UniqueID precedent).
 *
 * `assignMissingTocIds` mutates the supplied transaction with a
 * `setNodeMarkup` step for every anchor node that lacks a `tocId`. Two
 * structural guarantees make this loop-safe inside `appendTransaction`:
 *
 *   1. We only WRITE when `tocId` is missing. After the first pass, all
 *      anchors carry an ID, so the next call writes nothing and returns
 *      a transaction with `docChanged: false`.
 *   2. Existing IDs (already on the doc, or carried in via `parseHTML`
 *      when loading saved content) are never overwritten - we treat
 *      them as authoritative and only generate fresh IDs for nodes
 *      whose `tocId` is missing OR clashes with an earlier node in the
 *      same doc walk (paste-time collision rename).
 *
 * No PM transaction meta key is required - this is the "missing-attr
 * predicate" pattern UniqueID uses for the same reason.
 */
import type { Node as PMNode } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';

export interface AssignTocIdsOptions {
  /** Node names treated as heading-like anchors. */
  anchorTypes: string[];
  /** ID generator. Receives existing IDs so callers can avoid collisions. */
  generateId: (existingIds: ReadonlySet<string>) => string;
}

/**
 * Walk `doc` and assign a fresh `tocId` to every anchor node that
 * lacks one. Existing IDs are preserved unless they collide with an
 * earlier-seen anchor (the second occurrence is renamed).
 *
 * Mutates `tr` in place via `setNodeMarkup`. The caller decides whether
 * to dispatch `tr` (typically: only if `tr.docChanged` after this call).
 */
export function assignMissingTocIds(
  doc: PMNode,
  tr: Transaction,
  options: AssignTocIdsOptions,
): void {
  const { anchorTypes, generateId } = options;
  const seenIds = new Set<string>();

  // Single pass: for each anchor, either keep an existing unique ID or
  // assign a fresh one. We mark `seenIds` AFTER any rename so later
  // duplicates rename against the post-rename set.
  doc.descendants((node, pos) => {
    if (!anchorTypes.includes(node.type.name)) return;

    const rawId: unknown = node.attrs['tocId'];
    const existing = typeof rawId === 'string' && rawId.length > 0 ? rawId : null;

    if (existing && !seenIds.has(existing)) {
      seenIds.add(existing);
      return;
    }

    // Either missing or a collision with an earlier anchor in this doc.
    let id = generateId(seenIds);
    while (seenIds.has(id)) {
      id = generateId(seenIds);
    }
    seenIds.add(id);

    // Map the position through the steps already applied to `tr` so the
    // markup lands at the current location even if a previous iteration
    // changed offsets. `setNodeMarkup` doesn't change document length,
    // but the discipline keeps us safe if the helper is ever extended.
    const mappedPos = tr.mapping.map(pos);
    tr.setNodeMarkup(mappedPos, undefined, { ...node.attrs, tocId: id });
  });
}
