import { Plugin } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { surfaceTone } from '../helpers/surfaceTone.js';
import { compositeContrastColor, measuredContrastColor, readableTextColor } from '../helpers/textColorContrast.js';
import type { ContrastColor } from '../helpers/textColorContrast.js';
import { textColorReadabilityKey } from './textColorReadabilityKey.js';
import { readableTextMarks, textStyleMarkView } from './textStyleMarkView.js';

const SELECTOR = '[data-dm-text-contrast]';
const PROPERTY = '--dm-readable-color';
const BATCH = 200;
const DEPTH = 128;
const clear: ContrastColor = [0, 0, 0, 0];

/** A nonuniform surface, or a compositing effect that this deliberately narrow policy cannot measure. */
function effect(style: CSSStyleDeclaration): boolean {
  return style.opacity !== '' && Number(style.opacity) !== 1
    || !!style.filter && style.filter !== 'none'
    || !!style.mixBlendMode && style.mixBlendMode !== 'normal'
    || /\binset\b/u.test(style.boxShadow)
    || !!style.getPropertyValue('backdrop-filter') && style.getPropertyValue('backdrop-filter') !== 'none';
}

/** View-only, with a bounded batch of measured spans per frame and one shared style cache per pass. */
function readabilityView(view: EditorView): { update: (next: EditorView, previous: typeof view.state) => void; destroy: () => void } {
  const root = view.dom;
  const win = root.ownerDocument.defaultView;
  if (!win || typeof win.requestAnimationFrame !== 'function') return { update: () => undefined, destroy: () => undefined };
  const css = (win as unknown as { CSS?: { supports?: (condition: string) => boolean } }).CSS;
  let frame = 0;
  let destroyed = false;
  let queue: HTMLElement[] | null = null;
  let next = 0;
  let styles = new WeakMap<Element, CSSStyleDeclaration>();
  let pseudoPaint = new WeakMap<Element, boolean>();
  const colors = new Map<string, ContrastColor | null>();
  const adjustments = new Map<string, string | null>();
  const styleOf = (element: Element): CSSStyleDeclaration => {
    let result = styles.get(element);
    if (!result) { result = win.getComputedStyle(element); styles.set(element, result); }
    return result;
  };
  const paintedPseudo = (element: Element): boolean => {
    const cached = pseudoPaint.get(element);
    if (cached !== undefined) return cached;
    let result = false;
    if (css?.supports?.('selector(::before)')) {
      for (const pseudo of ['::before', '::after']) {
        const style = win.getComputedStyle(element, pseudo);
        if (!style.content || style.content === 'none' || style.content === 'normal' || style.display === 'none'
          || style.visibility === 'hidden' || style.opacity === '0') continue;
        const background = measuredContrastColor(style.backgroundColor);
        if (!background || background[3] > 0 || style.backgroundImage && style.backgroundImage !== 'none') result = true;
      }
    }
    pseudoPaint.set(element, result);
    return result;
  };
  // A single temporary probe resolves constant CSS named colors and hsl() using this document's browser. Variables,
  // system colors and currentColor belong to the host's palette and never enter the automatic policy.
  const literal = (value: string): ContrastColor | null => {
    if (colors.has(value)) return colors.get(value) ?? null;
    let result = measuredContrastColor(value);
    if (!result && value.length <= 256 && (/^hsla?\(/iu.test(value) || /^[a-z]+$/iu.test(value) && surfaceTone(value))) {
      const probe = root.ownerDocument.createElement('span');
      probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;';
      probe.style.color = value;
      root.ownerDocument.body.append(probe);
      try { result = measuredContrastColor(win.getComputedStyle(probe).color); }
      finally { probe.remove(); }
    }
    if (colors.size >= 512) colors.clear();
    colors.set(value, result);
    return result;
  };
  const backdrop = (element: HTMLElement): ContrastColor | null => {
    let paint = clear;
    let ancestor: HTMLElement | null = element;
    let depth = 0;
    while (ancestor && depth++ < DEPTH) {
      const style = styleOf(ancestor);
      // Effects on an ancestor still affect text even after an opaque background has been found.
      if (effect(style) || paintedPseudo(ancestor)) return null;
      if (paint[3] < 1) {
        if (style.backgroundImage && style.backgroundImage !== 'none' || style.backgroundClip === 'text') return null;
        const color = measuredContrastColor(style.backgroundColor);
        if (!color) return null;
        paint = compositeContrastColor(paint, color);
      }
      ancestor = ancestor.parentElement;
    }
    // Do not guess the browser canvas behind a transparent page, or the color beyond a depth bound.
    return ancestor === null && paint[3] === 1 ? paint : null;
  };
  const run = (): void => {
    frame = 0;
    if (destroyed) return;
    observe();
    if (!queue) {
      queue = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR));
      next = 0;
      styles = new WeakMap();
      pseudoPaint = new WeakMap();
    }
    const writes: { element: HTMLElement; color: string | null }[] = [];
    const until = Math.min(next + BATCH, queue.length);
    for (; next < until; next++) {
      const element = queue[next];
      if (!element || !root.contains(element) || element.closest('.ProseMirror') !== root) continue;
      const record = readableTextMarks.get(element);
      if (!record) continue;
      const text = literal(record.color);
      const surface = text?.[3] === 1 ? backdrop(element) : null;
      let color: string | null = null;
      if (text && surface) {
        const key = `${text.join(',')}/${surface.join(',')}`;
        if (adjustments.has(key)) color = adjustments.get(key) ?? null;
        else {
          color = readableTextColor(text, surface);
          if (adjustments.size >= 512) adjustments.clear();
          adjustments.set(key, color);
        }
      }
      writes.push({ element, color });
    }
    // All layout reads precede writes, which touch only the mark view's private presentation properties.
    for (const { element, color } of writes) {
      const record = readableTextMarks.get(element);
      if (!record) continue;
      const state = color ? 'adjusted' : 'auto';
      if (element.style.getPropertyValue(PROPERTY) !== (color ?? '')) {
        if (color) element.style.setProperty('--dm-readable-color', color);
        else element.style.removeProperty('--dm-readable-color');
      }
      if (element.getAttribute('data-dm-text-contrast') !== state) element.setAttribute('data-dm-text-contrast', state);
      record.writtenStyle = element.getAttribute('style');
      record.writtenState = state;
    }
    if (next < queue.length) frame = win.requestAnimationFrame(run);
    else queue = null;
  };
  const schedule = (): void => {
    if (destroyed) return;
    queue = null;
    if (!frame) frame = win.requestAnimationFrame(run);
  };
  const observer = new win.MutationObserver(records => {
    if (records.every(mutation => {
      // Ancestor child lists tell us when this editor moves. Unrelated page content, including the short-lived color
      // probe, must not restart a pass. Mutation records retain removed nodes after they have moved to their new parent.
      if (mutation.type === 'childList' && mutation.target !== root && !root.contains(mutation.target) && !head?.contains(mutation.target)) {
        return ![...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)].some(node => node === root || node.contains(root));
      }
      const element = mutation.target.nodeType === 1 ? mutation.target as HTMLElement : null;
      const record = element && readableTextMarks.get(element);
      return record && mutation.type === 'attributes'
        && (mutation.attributeName === 'style' && element.getAttribute('style') === record.writtenStyle
          || mutation.attributeName === 'data-dm-text-contrast' && element.getAttribute('data-dm-text-contrast') === record.writtenState);
    })) return;
    schedule();
  });
  const ancestors = new Set<Element>();
  const observe = (): void => {
    const current: Element[] = [];
    for (let node = root.parentElement; node; node = node.parentElement) current.push(node);
    if (current.length === ancestors.size && current.every(node => ancestors.has(node))) return;
    observer.disconnect();
    ancestors.clear();
    observer.observe(root, { subtree: true, attributes: true, childList: true });
    const head = root.ownerDocument.querySelector('head');
    if (head) observer.observe(head, { subtree: true, attributes: true, childList: true, characterData: true });
    for (const node of current) {
      ancestors.add(node);
      observer.observe(node, { attributes: true, childList: true });
    }
  };
  // Observe the editor even if construction happens before it is attached to a page.
  observer.observe(root, { subtree: true, attributes: true, childList: true });
  const head = root.ownerDocument.querySelector('head');
  if (head) observer.observe(head, { subtree: true, attributes: true, childList: true, characterData: true });
  observe();
  const refresh = (): void => { if (!destroyed) { observe(); schedule(); } };
  const transition = (event: Event): void => {
    const target = event.target;
    if (target instanceof win.Element && (root.contains(target) || target.contains(root))) refresh();
  };
  const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(refresh) : null;
  resize?.observe(root);
  const media = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-color-scheme: dark)') : null;
  media?.addEventListener('change', refresh);
  win.addEventListener('resize', refresh);
  win.addEventListener('pageshow', refresh);
  root.ownerDocument.addEventListener('visibilitychange', refresh);
  // Stylesheet loads and a completed CSS transition can change paint without a DOM attribute change.
  root.ownerDocument.addEventListener('load', refresh, true);
  root.ownerDocument.addEventListener('transitionend', transition, true);
  schedule();
  return {
    update(nextView, previous): void {
      if (destroyed) return;
      observe();
      if (nextView.state.doc !== previous.doc) schedule();
    },
    destroy(): void {
      destroyed = true;
      if (frame) win.cancelAnimationFrame(frame);
      observer.disconnect();
      resize?.disconnect();
      media?.removeEventListener('change', refresh);
      win.removeEventListener('resize', refresh);
      win.removeEventListener('pageshow', refresh);
      root.ownerDocument.removeEventListener('visibilitychange', refresh);
      root.ownerDocument.removeEventListener('load', refresh, true);
      root.ownerDocument.removeEventListener('transitionend', transition, true);
      queue = null;
      colors.clear();
      adjustments.clear();
    },
  };
}

export function textColorReadabilityPlugin(): Plugin<boolean> {
  return new Plugin({
    key: textColorReadabilityKey,
    state: { init: () => true, apply: () => true },
    props: { markViews: { textStyle: textStyleMarkView } },
    view: readabilityView,
  });
}
