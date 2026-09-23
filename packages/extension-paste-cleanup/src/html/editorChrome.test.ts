// @vitest-environment node
/**
 * What a Domternal editor renders around content it carries in attributes: the checkbox a task
 * item draws before its content, whose state is the item's data-checked, and the display and width
 * an aligned image is drawn with, whose alignment is its data-align. Dropping them loses nothing,
 * so they no longer report unsupported formatting, which showed a notice on every own copy.
 */
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import { normalizeClipboardHTML } from './normalize.js';

const NONCE = 'OwnCopyNonceOwnCopy_-A';
const own = (html: string): ReturnType<typeof normalizePasteHTML> =>
  normalizeClipboardHTML(html.replace('data-pm-slice', `data-domternal-copy="v1.${NONCE}" data-pm-slice`), {}, undefined, undefined, undefined,
    nonce => nonce === NONCE).result;
const codes = (result: ReturnType<typeof normalizePasteHTML>): string[] => result.diagnostics.map(diagnostic => diagnostic.code);

// As TaskItem renders an item, with Tiptap's empty span in the label as well.
const task = (checked: boolean, text: string, span = ''): string => `<li data-checked="${String(checked)}" data-type="taskItem"><label contenteditable="false">`
  + `<input type="checkbox"${checked ? ' checked="checked"' : ''} aria-label="Task status">${span}</label><div><p>${text}</p></div></li>`;
const TASKS = `<ul data-type="taskList" data-pm-slice="0 0 []">${task(true, 'done')}${task(false, 'todo', '<span></span>')}</ul>`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
// As Image renders an aligned image.
const aligned = (align: string, margins: string): string =>
  `<img src="${PNG}" data-align="${align}" style="display: block; width: fit-content; ${margins}">`;

describe('the chrome a Domternal editor renders around content its attributes carry', () => {
  it('drops a task item\'s checkbox without a finding, in an own copy and in other HTML', () => {
    const expected = '<ul data-type="taskList" data-pm-slice="0 0 []"><li data-type="taskItem" data-checked="true"><div><p>done</p></div></li>'
      + '<li data-type="taskItem" data-checked="false"><div><p>todo</p></div></li></ul>';
    expect(own(TASKS)).toMatchObject({ status: 'cleaned', html: expected, diagnostics: [] });
    expect(codes(normalizePasteHTML(TASKS))).toEqual([]);
  });

  it.each([['left', 'margin-right: auto;'], ['center', 'margin-left: auto; margin-right: auto;'], ['right', 'margin-left: auto;']])(
    'drops the display and width an image aligned %s is drawn with, without a finding',
    (align, margins) => {
      const result = normalizePasteHTML(`<p>x</p>${aligned(align, margins)}`);
      expect(codes(result)).toEqual([]);
      expect(result.html).toContain(`data-align="${align}"`);
      expect(result.html).not.toMatch(/display|fit-content/);
    },
  );

  it('still reports the same declarations where nothing carries what they draw', () => {
    expect(codes(normalizePasteHTML(`<img src="${PNG}" style="display: block; width: fit-content;">`))).toEqual(['unsupported-formatting']);
    expect(codes(normalizePasteHTML(`<p style="display: block">x</p>`))).toEqual(['unsupported-formatting']);
  });

  it('still reports a label with text in a task item, and a checkbox outside one', () => {
    expect(codes(normalizePasteHTML('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label>Read</label><div><p>x</p></div></li></ul>')))
      .toEqual(['unsupported-formatting']);
    expect(codes(normalizePasteHTML('<p><input type="checkbox"> x</p>'))).toEqual(['unsupported-formatting']);
  });
});
