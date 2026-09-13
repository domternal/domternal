import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Bold,
  BulletList,
  CodeBlock,
  Document,
  Editor,
  Extension,
  FontFamily,
  FontSize,
  Heading,
  Highlight,
  History,
  Italic,
  LineHeight,
  Link,
  ListItem,
  OrderedList,
  Paragraph,
  Strike,
  Subscript,
  Superscript,
  Text,
  TextAlign,
  TextColor,
  TextStyle,
  Underline,
} from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { redoDepth, undoDepth } from '@domternal/pm/history';
import { DOMParser as ProseMirrorDOMParser } from '@domternal/pm/model';
import { Plugin, TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { PasteCleanup } from './index.js';
import type { NormalizePasteHTMLResult, PasteCleanupOptions } from './index.js';

let editor: Editor | undefined;
let changes: Transaction[] = [];

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  changes = [];
  vi.restoreAllMocks();
});

function mount(
  options: PasteCleanupOptions = {},
  content = '<p>Original content</p>',
  extensions: NonNullable<EditorOptions['extensions']> = []
): Editor {
  editor = new Editor({
    extensions: [
      Document,
      Text,
      Paragraph,
      Heading,
      BulletList,
      OrderedList,
      ListItem,
      CodeBlock,
      Bold,
      Italic,
      Underline,
      Strike,
      Subscript,
      Superscript,
      Link.configure({ autolink: false, linkOnPaste: false }),
      History,
      PasteCleanup.configure(options),
      ...extensions,
    ],
    content,
    onTransaction: ({ transaction }) => {
      if (transaction.docChanged) changes.push(transaction);
    },
  });
  editor.commands.selectAll();
  return editor;
}

function paste(
  target: Editor,
  data: { html?: string; text?: string; flavors?: Readonly<Record<string, string>> },
  read: string[] = []
): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  const clipboard: Record<string, string | undefined> = {
    ...data.flavors,
    'text/html': data.html ?? '',
    'text/plain': data.text ?? '',
  };
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [],
      files: [],
      getData: (type: string) => {
        read.push(type);
        return clipboard[type] ?? '';
      },
    },
  });
  target.view.dom.dispatchEvent(event);
  return event;
}

describe('PasteCleanup editor integration', () => {
  it('cleans a selected replacement as one paste transaction with reversible selection', () => {
    const onResult = vi.fn();
    const instance = mount({ onResult }, '<p>Before old after</p>');
    instance.view.dispatch(
      instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 8, 11))
    );
    const before = instance.state.doc;
    const selectionBefore = instance.state.selection.toJSON();

    const event = paste(instance, {
      html: '<p class="MsoNormal"><span style="font-weight:700" onclick="alert(1)">New</span></p>',
      text: 'New',
    });

    expect(event.defaultPrevented).toBe(true);
    expect(instance.getHTML()).toBe('<p>Before <strong>New</strong> after</p>');
    expect(() => {
      instance.state.doc.check();
    }).not.toThrow();
    expect(changes).toHaveLength(1);
    expect(changes[0]?.getMeta('paste')).toBe(true);
    expect(changes[0]?.getMeta('uiEvent')).toBe('paste');
    expect(undoDepth(instance.state)).toBe(1);
    expect(onResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: 'cleaned',
        source: 'word',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'unsafe-content-removed' }),
        ]),
      })
    );
    const pasted = instance.state.doc;
    const selectionAfter = instance.state.selection.toJSON();
    expect(instance.state.selection.empty).toBe(true);
    expect(instance.state.selection.from).toBe(11);

    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(before)).toBe(true);
    expect(instance.state.selection.toJSON()).toEqual(selectionBefore);
    expect(undoDepth(instance.state)).toBe(0);
    expect(redoDepth(instance.state)).toBe(1);
    expect(instance.commands.redo()).toBe(true);
    expect(instance.state.doc.eq(pasted)).toBe(true);
    expect(instance.state.selection.toJSON()).toEqual(selectionAfter);
  });

  it('preserves headings and nested semantic lists in one undoable paste', () => {
    const instance = mount();
    const before = instance.state.doc;
    const html =
      '<h2>Title</h2><ol start="3"><li><p>Third</p><ul><li><p>Nested</p></li></ul></li></ol>';

    expect(paste(instance, { html }).defaultPrevented).toBe(true);

    expect(instance.getHTML()).toBe(html);
    expect(undoDepth(instance.state)).toBe(1);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(before)).toBe(true);
    expect(instance.commands.redo()).toBe(true);
    expect(instance.getHTML()).toBe(html);
  });

  it.each(['preserve', 'adapt'] as const)('retains semantic CSS marks in %s mode', (formatting) => {
    const results: NormalizePasteHTMLResult[] = [];
    const instance = mount({ formatting, onResult: (result) => results.push(result) }, '<p></p>', [
      TextStyle,
      FontFamily,
      FontSize,
      TextColor,
      Highlight,
      TextAlign,
      LineHeight.configure({ lineHeights: [] }),
    ]);
    paste(instance, {
      html: '<p style="text-align:center;line-height:1.7"><span style="font-family:Calibri;font-size:20px;color:#123456;background-color:#fedcba;font-weight:700;font-style:italic;text-decoration:underline line-through">Styled</span></p>',
    });

    const paragraph = instance.state.doc.firstChild;
    const text = paragraph?.firstChild;
    expect(text?.text).toBe('Styled');
    expect(text?.marks.map((mark) => mark.type.name)).toEqual(
      expect.arrayContaining(['bold', 'italic', 'underline', 'strike'])
    );
    expect(paragraph?.attrs['textAlign']).toBe(formatting === 'preserve' ? 'center' : 'left');
    expect(paragraph?.attrs['lineHeight']).toBe(formatting === 'preserve' ? '1.7' : null);
    const visual = text?.marks.find((mark) => mark.type.name === 'textStyle');
    if (formatting === 'preserve') {
      expect(visual?.attrs).toMatchObject({
        fontFamily: 'Calibri',
        fontSize: '20px',
        color: '#123456',
        backgroundColor: '#fedcba',
      });
      expect(results[0]?.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: 'formatting-adapted' })
      );
    } else {
      expect(visual).toBeUndefined();
      expect(results[0]?.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'formatting-adapted', severity: 'info' })
      );
    }
    expect(undoDepth(instance.state)).toBe(1);
  });

  it('preserves subscript and superscript without retaining their styling wrappers', () => {
    const instance = mount({ formatting: 'adapt' }, '<p></p>');

    paste(instance, {
      html: '<p>H<span style="vertical-align:sub;font-size:10px">2</span>O and x<span style="vertical-align:super">2</span></p>',
    });

    expect(instance.getHTML()).toBe('<p>H<sub>2</sub>O and x<sup>2</sup></p>');
  });

  it('leaves plain text literal and does not emit HTML diagnostics', () => {
    const onResult = vi.fn();
    const instance = mount({ onResult });

    expect(
      paste(instance, { text: '# Literal **text**\n<script>literal</script>' }).defaultPrevented
    ).toBe(true);

    expect(instance.getHTML()).toBe(
      '<p># Literal **text**</p><p>&lt;script&gt;literal&lt;/script&gt;</p>'
    );
    expect(instance.view.dom.querySelector('script')).toBeNull();
    expect(onResult).not.toHaveBeenCalled();
    expect(undoDepth(instance.state)).toBe(1);
  });

  it('keeps code-block paste as unformatted text with exact whitespace', () => {
    const onResult = vi.fn();
    const instance = mount({ onResult }, '<pre><code>old</code></pre>');
    instance.view.dispatch(
      instance.state.tr.setSelection(TextSelection.create(instance.state.doc, 1, 4))
    );
    const before = instance.state.doc;
    const selectionBefore = instance.state.selection.toJSON();
    const text = '  const html = "<b>literal</b>";\n\t**markdown**';

    expect(
      paste(instance, {
        html: '<p><strong>Different rich content</strong><img src="https://unsafe.test/pixel"></p>',
        text,
      }).defaultPrevented
    ).toBe(true);

    expect(instance.state.doc.childCount).toBe(1);
    expect(instance.state.doc.firstChild?.type.name).toBe('codeBlock');
    expect(instance.state.doc.firstChild?.textContent).toBe(text);
    expect(instance.state.doc.firstChild?.firstChild?.marks).toEqual([]);
    expect(instance.view.dom.querySelector('img, strong, b')).toBeNull();
    expect(onResult).not.toHaveBeenCalled();
    expect(undoDepth(instance.state)).toBe(1);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(before)).toBe(true);
    expect(instance.state.selection.toJSON()).toEqual(selectionBefore);
    expect(instance.commands.redo()).toBe(true);
    expect(instance.state.doc.firstChild?.textContent).toBe(text);
  });

  it('does not let a throwing result observer bypass cleaning', () => {
    const onResult = vi.fn(() => {
      throw new Error('Host observer failed');
    });
    const instance = mount({ onResult });

    expect(
      paste(instance, {
        html: '<p onclick="alert(1)">Safe<script>alert(2)</script><img src="https://unsafe.test/pixel" alt=" diagram"></p>',
      }).defaultPrevented
    ).toBe(true);

    expect(onResult).toHaveBeenCalledOnce();
    expect(instance.getHTML()).toBe('<p>Safe diagram</p>');
    expect(instance.view.dom.querySelector('script, img, [onclick]')).toBeNull();
    expect(changes).toHaveLength(1);
    expect(undoDepth(instance.state)).toBe(1);
  });

  it.each([
    { source: 'HTML', data: { html: '<p>' + 'x'.repeat(80) + '</p>', text: 'Fallback' } },
    { source: 'plain text', data: { html: '<p>Safe</p>', text: 'x'.repeat(80) } },
    { source: 'Text alias', data: { html: '<p>Safe</p>', text: 'Safe', flavors: { Text: 'x'.repeat(80) } } },
  ])(
    'rejects excess $source before downstream paste handlers can mutate the document',
    ({ data }) => {
      const onResult = vi.fn();
      const downstream = vi.fn((view: Editor['view']) => {
        view.dispatch(view.state.tr.insertText('Unsafe fallback'));
        return true;
      });
      const lowerHandler = Extension.create({
        name: 'rawClipboardFallback',
        priority: 1100,
        addProseMirrorPlugins: () => [new Plugin({ props: { handlePaste: downstream } })],
      });
      const instance = mount(
        { limits: { maxInputLength: 32 }, onResult },
        '<p>Keep selection</p>',
        [lowerHandler]
      );
      const before = instance.state.doc;
      const selectionBefore = instance.state.selection.toJSON();

      expect(paste(instance, data).defaultPrevented).toBe(true);

      expect(instance.state.doc.eq(before)).toBe(true);
      expect(instance.state.selection.toJSON()).toEqual(selectionBefore);
      expect(changes).toHaveLength(0);
      expect(undoDepth(instance.state)).toBe(0);
      expect(redoDepth(instance.state)).toBe(0);
      expect(downstream).not.toHaveBeenCalled();
      expect(onResult).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          status: 'rejected',
          html: '',
          diagnostics: [{ code: 'input-limit', severity: 'error' }],
        })
      );
    }
  );

  it.each(['text/rtf', 'application/rtf', 'text/uri-list'])(
    'pastes the HTML when %s, a flavor the editor never reads, exceeds the input ceiling',
    (flavor) => {
      const onResult = vi.fn();
      const instance = mount({ limits: { maxInputLength: 32 }, onResult }, '<p>Keep selection</p>');
      const read: string[] = [];

      expect(
        paste(instance, { html: '<p>Safe</p>', text: 'Safe', flavors: { [flavor]: 'x'.repeat(80) } }, read)
          .defaultPrevented
      ).toBe(true);

      expect(instance.getHTML()).toBe('<p>Safe</p>');
      expect(changes).toHaveLength(1);
      expect(read).not.toContain(flavor);
      expect(onResult).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ status: 'cleaned', html: '<p>Safe</p>' })
      );
    }
  );

  it('bounds the text ProseMirror makes of a URI list when the clipboard has no plain text', () => {
    const onResult = vi.fn();
    const instance = mount({ limits: { maxInputLength: 32 }, onResult }, '<p>Keep selection</p>');
    const before = instance.state.doc;

    expect(
      paste(instance, { flavors: { 'text/uri-list': 'https://example.com/' + 'x'.repeat(80) } })
        .defaultPrevented
    ).toBe(true);

    expect(instance.state.doc.eq(before)).toBe(true);
    expect(changes).toHaveLength(0);
    expect(onResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 'rejected', diagnostics: [{ code: 'input-limit', severity: 'error' }] })
    );
  });

  it('blocks structure rejection before a lower handler can consume the raw clipboard', () => {
    const onResult = vi.fn(() => {
      throw new Error('Host rejection observer failed');
    });
    const downstream = vi.fn((view: Editor['view']) => {
      view.dispatch(view.state.tr.insertText('Unsafe fallback'));
      return true;
    });
    const lowerHandler = Extension.create({
      name: 'rawClipboardFallback',
      priority: 1100,
      addProseMirrorPlugins: () => [new Plugin({ props: { handlePaste: downstream } })],
    });
    const instance = mount({ limits: { maxDepth: 4 }, onResult }, '<p>Keep selection</p>', [
      lowerHandler,
    ]);
    const before = instance.state.doc;
    const selectionBefore = instance.state.selection.toJSON();

    expect(
      paste(instance, {
        html: '<div>'.repeat(12) + 'Rejected' + '</div>'.repeat(12),
        text: 'Do not insert this fallback',
      }).defaultPrevented
    ).toBe(true);

    expect(instance.state.doc.eq(before)).toBe(true);
    expect(instance.state.selection.toJSON()).toEqual(selectionBefore);
    expect(changes).toHaveLength(0);
    expect(undoDepth(instance.state)).toBe(0);
    expect(downstream).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: 'rejected',
        html: '',
        diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'structure-limit' })]),
      })
    );
  });

  it('allows a normal plain-text paste after a rejected HTML paste', () => {
    const onResult = vi.fn();
    const instance = mount({ limits: { maxDepth: 4 }, onResult });
    const before = instance.state.doc;

    expect(
      paste(instance, {
        html: '<div>'.repeat(12) + 'Rejected' + '</div>'.repeat(12),
      }).defaultPrevented
    ).toBe(true);
    expect(instance.state.doc.eq(before)).toBe(true);
    expect(paste(instance, { text: 'Accepted text' }).defaultPrevented).toBe(true);

    expect(instance.getHTML()).toBe('<p>Accepted text</p>');
    expect(onResult).toHaveBeenCalledOnce();
    expect(changes).toHaveLength(1);
    expect(undoDepth(instance.state)).toBe(1);
    expect(instance.commands.undo()).toBe(true);
    expect(instance.state.doc.eq(before)).toBe(true);
  });

  it('removes resource attributes and active elements before ProseMirror parses DOM', () => {
    const parsedHTML: string[] = [];
    const downstreamHTML = vi.fn((html: string) => html);
    const inspectParser = Extension.create({
      name: 'inspectCleanClipboard',
      priority: 1100,
      addProseMirrorPlugins() {
        if (!(this.editor instanceof Editor))
          throw new Error('Editor is required for the parser observer');
        const parser = ProseMirrorDOMParser.fromSchema(this.editor.schema);
        const parseSlice = parser.parseSlice.bind(parser);
        vi.spyOn(parser, 'parseSlice').mockImplementation((dom, options) => {
          parsedHTML.push((dom as HTMLElement).innerHTML);
          expect(
            (dom as HTMLElement).querySelector(
              'script, style, iframe, object, embed, svg, math, img, link, base, [onclick], [srcset], [srcdoc], [background]'
            )
          ).toBeNull();
          expect((dom as HTMLElement).innerHTML).not.toMatch(/(?:javascript:|unsafe\.test|url\()/i);
          return parseSlice(dom, options);
        });
        return [
          new Plugin({ props: { clipboardParser: parser, transformPastedHTML: downstreamHTML } }),
        ];
      },
    });
    const instance = mount({}, '<p></p>', [inspectParser]);
    const html =
      '<base href="https://unsafe.test/base"><link rel="stylesheet" href="https://unsafe.test/style"><style>body{background:url(https://unsafe.test/css)}</style><script>alert(1)</script><iframe src="https://unsafe.test/frame" srcdoc="bad"></iframe><object data="https://unsafe.test/object"></object><p onclick="alert(2)" background="https://unsafe.test/background" style="background-image:url(https://unsafe.test/image)">Safe <a href="javascript:alert(3)">link</a><img src="https://unsafe.test/pixel" srcset="https://unsafe.test/pixel2 2x" onerror="alert(4)" alt=" diagram"></p>';

    expect(paste(instance, { html }).defaultPrevented).toBe(true);

    expect(downstreamHTML).toHaveBeenCalledOnce();
    expect(downstreamHTML.mock.calls[0]?.[0]).toBe('<p>Safe <a>link</a> diagram</p>');
    expect(parsedHTML).toEqual(['<p>Safe <a>link</a> diagram</p>']);
    expect(instance.getHTML()).toBe('<p>Safe link diagram</p>');
    expect(
      instance.view.dom.querySelector(
        'script, style, iframe, object, embed, svg, math, img, link, base, [onclick], [srcset], [srcdoc], [background]'
      )
    ).toBeNull();
  });
});
