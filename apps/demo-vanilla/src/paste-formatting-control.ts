import type { PasteFormatting } from '@domternal/extension-paste-cleanup';

/** The application owns this choice; PasteCleanup snapshots it when a paste starts. */
export function createPasteFormattingControl(): { element: HTMLLabelElement; readonly formatting: PasteFormatting } {
  const element = document.createElement('label');
  element.className = 'demo-paste-formatting';
  const select = document.createElement('select');
  select.className = 'language-select';
  select.dataset.testid = 'paste-formatting';
  for (const [value, label] of [['preserve', 'Keep source formatting'], ['adapt', 'Match editor formatting']] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  element.append('Paste formatting ', select);
  return { element, get formatting() { return select.value === 'adapt' ? 'adapt' : 'preserve'; } };
}
