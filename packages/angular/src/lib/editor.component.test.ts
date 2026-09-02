import '@angular/compiler';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor, ListItem, OrderedList, type Content, type ContentDiagnosticProps, type JSONContent } from '@domternal/core';
import { DEFAULT_EXTENSIONS, DomternalEditorComponent } from './editor.component.js';

TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

const extensions = [OrderedList, ListItem];

/** JSON the current editor wrote, with a list marker this version does not know. */
function storedDocument(text = 'One'): JSONContent {
  const scratch = new Editor({
    extensions: [...DEFAULT_EXTENSIONS, ...extensions],
    content: `<ol><li><p>${text}</p></li></ol><p>tail</p>`,
  });
  const json = scratch.getJSON();
  scratch.destroy();
  const list = json.content?.[0];
  if (!list) throw new Error('The scratch document has no list.');
  list.attrs = { ...list.attrs, listStyleType: 'bogus' };
  return json;
}

/** Stores an unknown marker the way a bound collaborative document does: without validation or history. */
function holdUnknownMarker(editor: Editor): void {
  const tr = editor.state.tr.setMeta('addToHistory', false);
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'orderedList') tr.setNodeAttribute(pos, 'listStyleType', 'bogus');
  });
  editor.view.dispatch(tr);
}

type Report = Omit<ContentDiagnosticProps, 'editor'> & { editor: Editor };

/** Records what the editor component reports, as an application template would bind it. */
class Recorder {
  readonly extensions = extensions;
  readonly created: Editor[] = [];
  readonly reports: unknown[] = [];
  readonly sources: string[] = [];
  readonly errors: unknown[] = [];

  report({ editor, source, total, diagnostics }: Report): void {
    this.sources.push(source);
    this.reports.push({
      source, total, diagnostics, created: this.created.length,
      marker: editor.getJSON().content?.[0]?.attrs?.['listStyleType'],
    });
  }

  error({ editor, error, content }: { editor: Editor; error: Error; content: unknown }): void {
    this.errors.push({ rejected: content, isError: error instanceof Error, empty: editor.isEmpty, created: this.created.length });
  }

  get editor(): Editor {
    const editor = this.created.at(-1);
    if (!editor) throw new Error('Expected a live editor.');
    return editor;
  }
}

const outputs = `(editorCreated)="created.push($event)" (contentDiagnostic)="report($event)" (contentError)="error($event)"`;

class ContentHost extends Recorder {
  readonly content = signal<Content>(storedDocument());
}
Component({
  selector: 'content-host',
  imports: [DomternalEditorComponent],
  template: `<domternal-editor [extensions]="extensions" outputFormat="json" [content]="content()" ${outputs} />`,
})(ContentHost);

class FormHost extends Recorder {
  readonly control = new FormControl<Content>(storedDocument(), { nonNullable: true });
}
Component({
  selector: 'form-host',
  imports: [ReactiveFormsModule, DomternalEditorComponent],
  template: `<domternal-editor [extensions]="extensions" outputFormat="json" [formControl]="control" ${outputs} />`,
})(FormHost);

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
});

afterEach(() => {
  TestBed.resetTestingModule();
});

const modelPaths = [
  { path: '[content]', host: ContentHost, send: (host: Recorder, value: JSONContent) => { (host as ContentHost).content.set(value); } },
  { path: 'writeValue', host: FormHost, send: (host: Recorder, value: JSONContent) => { (host as FormHost).control.setValue(value); } },
];

describe('DomternalEditorComponent content reports', () => {
  it('emits the initial report once the editor is ready, before editorCreated, then later reports', async () => {
    const fixture = TestBed.createComponent(ContentHost);
    await fixture.whenStable();
    const host = fixture.componentInstance;
    expect(host.reports).toEqual([{
      source: 'content',
      total: 1,
      diagnostics: [{ code: 'unknown-list-marker', nodeType: 'orderedList', attribute: 'listStyleType', path: [0], value: 'bogus' }],
      created: 0,
      marker: null,
    }]);

    host.editor.commands.setContent(storedDocument());
    expect(host.reports).toHaveLength(2);
    expect(host.reports[1]).toMatchObject({ source: 'setContent', total: 1, created: 1 });
  });

  it('emits contentError for initial content the schema rejects', async () => {
    const content = { type: 'doc', content: [{ type: 'missingNode' }] };
    const fixture = TestBed.createComponent(ContentHost);
    fixture.componentInstance.content.set(content);
    await fixture.whenStable();
    expect(fixture.componentInstance.errors).toEqual([{ rejected: content, isError: true, empty: true, created: 0 }]);
  });

  it.each(modelPaths)('keeps the document and selection when $path passes an equal JSON value with an unknown marker again', async ({ host: type, send }) => {
    const fixture = TestBed.createComponent<Recorder>(type);
    await fixture.whenStable();
    const host = fixture.componentInstance;
    const editor = host.editor;
    const doc = editor.state.doc;
    const selection = editor.state.selection;
    // Replacing the document would move the selection to its end.
    expect(selection.from).toBeLessThan(doc.content.size - 2);
    const control = host instanceof FormHost ? host.control : null;

    // A new object with the same content, as a model write of an unchanged value produces.
    send(host, storedDocument());
    await fixture.whenStable();
    expect(editor.state.doc).toBe(doc);
    expect(editor.state.selection.eq(selection)).toBe(true);
    expect(host.sources).toEqual(['content']);
    expect(control?.dirty ?? false).toBe(false);

    // A genuine change still reaches the editor.
    send(host, storedDocument('Two'));
    await fixture.whenStable();
    expect(editor.getText()).toBe('Two\n\ntail');
    expect(host.sources).toEqual(['content', 'setContent']);
    expect(control?.dirty ?? false).toBe(false);
    expect(host.created).toHaveLength(1);
  });

  it.each(modelPaths)('keeps a document that holds an unknown marker when $path echoes its JSON back', async ({ host: type, send }) => {
    const fixture = TestBed.createComponent<Recorder>(type);
    await fixture.whenStable();
    const host = fixture.componentInstance;
    const editor = host.editor;
    holdUnknownMarker(editor);
    await fixture.whenStable();
    const doc = editor.state.doc;
    const selection = editor.state.selection;
    const sources = [...host.sources];

    // The document's own JSON, as a model round trip hands it back.
    send(host, editor.getJSON());
    await fixture.whenStable();
    expect(editor.state.doc).toBe(doc);
    expect(editor.state.selection.eq(selection)).toBe(true);
    expect(editor.getJSON().content?.[0]?.attrs?.['listStyleType']).toBe('bogus');
    expect(host.sources).toEqual(sources);
  });
});
