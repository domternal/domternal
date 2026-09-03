import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor, ListItem, OrderedList, type JSONContent } from '@domternal/core';
import { DEFAULT_EXTENSIONS, DomternalEditor } from './DomternalEditor.js';

const extensions = [OrderedList, ListItem];

/** JSON the current editor wrote, with a list marker this version does not know. */
function storedDocument(): JSONContent {
  const scratch = new Editor({
    extensions: [...DEFAULT_EXTENSIONS, ...extensions],
    content: '<ol><li><p>One</p></li></ol><p>tail</p>',
  });
  const json = scratch.getJSON();
  scratch.destroy();
  const list = json.content?.[0];
  if (!list) throw new Error('The scratch document has no list.');
  list.attrs = { ...list.attrs, listStyleType: 'bogus' };
  return json;
}

let host: HTMLDivElement;
let wrapper: DomternalEditor | undefined;
let created: number;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  created = 0;
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = undefined;
  host.remove();
});

describe('DomternalEditor content reports', () => {
  it('reports the initial content once the editor is ready, then later reports to the callback and as events', () => {
    const stored = storedDocument();
    const received: unknown[] = [];
    wrapper = new DomternalEditor(host, {
      extensions,
      content: stored,
      onCreate: () => { created++; },
      onContentDiagnostic: ({ editor, source, total, diagnostics }) => {
        received.push({ source, total, diagnostics, created, marker: editor.getJSON().content?.[0]?.attrs?.['listStyleType'] });
      },
    });
    expect(received).toEqual([{
      source: 'content',
      total: 1,
      diagnostics: [{ code: 'unknown-list-marker', nodeType: 'orderedList', attribute: 'listStyleType', path: [0], value: 'bogus' }],
      created: 0,
      marker: null,
    }]);

    const events: unknown[] = [];
    wrapper.addEventListener('contentdiagnostic', (event) => {
      const { detail } = event as CustomEvent<{ editor: Editor; source: string; total: number }>;
      events.push({ source: detail.source, total: detail.total, same: detail.editor === wrapper?.editor });
    });
    wrapper.setContent(stored);
    expect(received).toHaveLength(2);
    expect(received[1]).toMatchObject({ source: 'setContent', total: 1, created: 1 });
    expect(events).toEqual([{ source: 'setContent', total: 1, same: true }]);
  });

  it('reports initial content the schema rejects to onContentError once the editor is ready', () => {
    const content = { type: 'doc', content: [{ type: 'missingNode' }] };
    const received: unknown[] = [];
    wrapper = new DomternalEditor(host, {
      content,
      onCreate: () => { created++; },
      onContentError: ({ editor, error, content: rejected }) => {
        received.push({ rejected, isError: error instanceof Error, empty: editor.isEmpty, created });
      },
    });
    expect(received).toEqual([{ rejected: content, isError: true, empty: true, created: 0 }]);
  });
});
