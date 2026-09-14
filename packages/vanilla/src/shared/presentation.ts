interface PresentationState {
  signature: string;
  text: Text | null;
  indicator: HTMLElement | null;
}

const states = new WeakMap<HTMLElement, PresentationState>();

export function patchPresentationText(element: HTMLElement, text: string): void {
  const node = element.firstChild;
  if (node?.nodeType === 3 && element.childNodes.length === 1) {
    if (node.nodeValue !== text) node.nodeValue = text;
  } else if (element.textContent !== text) element.textContent = text;
}

/** Patch labels independently of trusted icon markup, retaining the button and text nodes. */
export function patchIconText(
  element: HTMLElement,
  icon: string,
  label: string | null,
  options: { caret?: string; textClass?: string; color?: string | null } = {},
): void {
  const hasColor = options.color !== null && options.color !== undefined;
  const signature = JSON.stringify([icon, label !== null, options.caret, options.textClass, hasColor]);
  let state = states.get(element);
  if (state?.signature !== signature) {
    const document = element.ownerDocument;
    const fragment = document.createDocumentFragment();
    const appendIcon = (html: string): void => {
      if (!html) return;
      const container = document.createElement('span');
      container.innerHTML = html;
      fragment.append(...Array.from(container.childNodes));
    };
    appendIcon(icon);
    const text = label === null ? null : document.createTextNode(label);
    if (text) {
      if (options.textClass) {
        const span = document.createElement('span');
        span.className = options.textClass;
        span.appendChild(text);
        fragment.appendChild(span);
      } else {
        if (icon) fragment.appendChild(document.createTextNode(' '));
        fragment.appendChild(text);
      }
    }
    appendIcon(options.caret ?? '');
    const indicator = hasColor ? document.createElement('span') : null;
    if (indicator) {
      indicator.className = 'dm-toolbar-color-indicator';
      fragment.appendChild(indicator);
    }
    element.replaceChildren(fragment);
    state = { signature, text, indicator };
    states.set(element, state);
  }
  if (state.text && label !== null && state.text.data !== label) state.text.data = label;
  if (state.indicator) state.indicator.style.backgroundColor = options.color ?? '';
}

export function setPresentationLanguage(element: HTMLElement, language: string | undefined): void {
  if (language === undefined) element.removeAttribute('lang');
  else if (element.lang !== language) element.lang = language;
}

/** Compatibility for public helpers that return HTML strings instead of DOM nodes. */
export function escapePresentationText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
