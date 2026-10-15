/**
 * A whole list item needs its paragraph label before a nested list. Without that label,
 * ProseMirror can close the item and move subsequent siblings into a different list.
 * Only malformed closed content is copied; a native open-start copy retains its depths.
 */
const VISIBLE = /[^\t\n\f\r ]/;

function declaredOpen(element: HTMLElement): number | undefined {
  const marker = element.getAttribute('data-pm-slice');
  if (marker === null) return undefined;
  const open = Number(/^(\d+) \d+(?: -\d+)? /.exec(marker)?.[1]);
  return Number.isSafeInteger(open) ? open : 0;
}

function openStart(item: HTMLElement): boolean {
  let depth = 1;
  for (let current: HTMLElement | null = item; current !== null; current = current.parentElement, depth++) {
    const open = declaredOpen(current);
    if (open !== undefined) return depth <= open;
    if (current.parentElement !== null && current.parentElement.firstElementChild !== current) return false;
  }
  return false;
}

function leading(parent: HTMLElement, task: boolean): ChildNode | undefined {
  for (let child = parent.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === 8 || (child.nodeType === 3 && !VISIBLE.test(child.nodeValue ?? ''))) continue;
    if (task && child.nodeType === 1) {
      const element = child as HTMLElement;
      if ((element.localName === 'input' && element.getAttribute('type') === 'checkbox')
        || (element.localName === 'label' && element.getAttribute('contenteditable') === 'false')) continue;
    }
    return child;
  }
  return undefined;
}

function labelTarget(item: HTMLElement): HTMLElement | undefined {
  const task = item.getAttribute('data-type') === 'taskItem' || item.classList.contains('task-list-item');
  let parent = item;
  let first = leading(parent, task);
  // The task item's own HTML puts its content in a div after the non-editable checkbox label.
  if (task && first?.nodeType === 1 && (first as HTMLElement).localName === 'div') {
    parent = first as HTMLElement;
    first = leading(parent, false);
  }
  return first?.nodeType === 1 && ['ul', 'ol'].includes((first as HTMLElement).localName) ? parent : undefined;
}

export function listItemContent(item: HTMLElement): HTMLElement {
  if (labelTarget(item) === undefined || openStart(item)) return item;
  const copy = item.cloneNode(true) as HTMLElement;
  // Repair the detached subtree once, propagating open-start depths instead of repeatedly
  // walking every nested item's ancestors. Collect targets before adding any new elements.
  const targets: HTMLElement[] = [];
  const pending = [{ element: copy, remaining: 0 }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    const { element } = entry;
    const remaining = declaredOpen(element) ?? entry.remaining;
    if (element.localName === 'li' && remaining < 1) {
      const target = labelTarget(element);
      if (target !== undefined) targets.push(target);
    }
    for (let child = element.lastElementChild; child !== null; child = child.previousElementSibling) {
      pending.push({ element: child as HTMLElement, remaining: child === element.firstElementChild ? Math.max(0, remaining - 1) : 0 });
    }
  }
  for (const target of targets) target.insertBefore(target.ownerDocument.createElement('p'), target.firstChild);
  return copy;
}
