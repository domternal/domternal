/** Preserve the native pointer target when an existing label changes. */
export function setLabelText(element: HTMLElement, value: string): void {
  const text = element.firstChild;
  if (text?.nodeType === 3 && text === element.lastChild) {
    if (text.nodeValue !== value) text.nodeValue = value;
  } else {
    element.textContent = value;
  }
}
